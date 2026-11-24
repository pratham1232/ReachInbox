import type IORedis from 'ioredis';
import { env } from '../config/env.js';

export interface HourWindowInfo {
  hourWindow: string;
  windowStartMs: number;
  nextHourStartMs: number;
  ttlSeconds: number;
}

export function getHourWindowInfo(nowMs: number = Date.now()): HourWindowInfo {
  const hourMs = 3600 * 1000;
  const windowStartMs = Math.floor(nowMs / hourMs) * hourMs;
  const nextHourStartMs = windowStartMs + hourMs;
  const hourWindow = new Date(windowStartMs).toISOString().slice(0, 13); // e.g. 2026-11-24T17
  const ttlSeconds = Math.max(60, Math.ceil((nextHourStartMs - nowMs) / 1000) + 120);
  return { hourWindow, windowStartMs, nextHourStartMs, ttlSeconds };
}

/**
 * Atomic Lua script:
 * Checks sender counter and optional global counter BEFORE incrementing.
 * If either would exceed its limit, neither is incremented and it returns {0, currentCount, scope}.
 * Otherwise both are incremented and EXPIRE is set if key is new.
 */
const ACQUIRE_RATE_LUA = `
local senderKey = KEYS[1]
local globalKey = KEYS[2]
local senderLimit = tonumber(ARGV[1])
local globalLimit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local senderCount = tonumber(redis.call('GET', senderKey) or '0')
if senderCount >= senderLimit then
  return {0, senderCount, 'sender'}
end

if globalLimit > 0 then
  local globalCount = tonumber(redis.call('GET', globalKey) or '0')
  if globalCount >= globalLimit then
    return {0, globalCount, 'global'}
  end
end

local newSenderCount = redis.call('INCR', senderKey)
if newSenderCount == 1 then
  redis.call('EXPIRE', senderKey, ttl)
end

if globalLimit > 0 then
  local newGlobalCount = redis.call('INCR', globalKey)
  if newGlobalCount == 1 then
    redis.call('EXPIRE', globalKey, ttl)
  end
end

return {1, newSenderCount, 'ok'}
`;

export interface RateLimitCheckResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
  scope: 'sender' | 'global' | 'ok';
  hourWindow: string;
  nextHourStartMs: number;
}

export async function acquireHourlyRateLimit(
  redisClient: IORedis.default,
  params: {
    senderId: string;
    senderHourlyLimit?: number | null;
    globalHourlyLimit?: number;
    nowMs?: number;
  },
): Promise<RateLimitCheckResult> {
  const nowMs = params.nowMs ?? Date.now();
  const { hourWindow, nextHourStartMs, ttlSeconds } = getHourWindowInfo(nowMs);

  const senderLimit = params.senderHourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER;
  const globalLimit = params.globalHourlyLimit ?? env.MAX_EMAILS_PER_HOUR;

  const senderKey = `rate:${params.senderId}:${hourWindow}`;
  const globalKey = `rate:global:${hourWindow}`;

  const rawResult = (await redisClient.eval(
    ACQUIRE_RATE_LUA,
    2,
    senderKey,
    globalKey,
    String(senderLimit),
    String(globalLimit),
    String(ttlSeconds),
  )) as [number, number, string];

  const allowed = rawResult[0] === 1;
  const currentCount = Number(rawResult[1]);
  const scope = (rawResult[2] as 'sender' | 'global' | 'ok') ?? 'ok';

  return {
    allowed,
    currentCount,
    limit: scope === 'global' ? globalLimit : senderLimit,
    scope,
    hourWindow,
    nextHourStartMs,
  };
}

export async function getDeferredCountForWindow(
  redisClient: IORedis.default,
  senderId: string,
  hourWindow: string,
): Promise<number> {
  const key = `deferred:${senderId}:${hourWindow}`;
  return redisClient.incr(key);
}

export async function getCurrentDeferredCount(
  redisClient: IORedis.default,
  senderId: string,
  hourWindow: string,
): Promise<number> {
  const key = `deferred:${senderId}:${hourWindow}`;
  const val = await redisClient.get(key);
  return val ? Number(val) : 0;
}

/**
 * Computes deterministic reschedule timestamp in the next hour window,
 * preserving relative order by sequenceIndex * minDelayMs.
 */
export function computeRescheduleTimestampMs(params: {
  nextHourStartMs: number;
  sequenceIndex: number;
  minDelayMs: number;
  hourlyLimit: number;
}): number {
  const { nextHourStartMs, sequenceIndex, minDelayMs, hourlyLimit } = params;
  const safeLimit = Math.max(1, hourlyLimit);
  const indexWithinWindow = sequenceIndex % safeLimit;
  const overflowWindows = Math.max(0, Math.floor(sequenceIndex / safeLimit) - 1);
  const hourMs = 3600 * 1000;
  const effectiveDelay = Math.max(100, minDelayMs);
  return nextHourStartMs + overflowWindows * hourMs + indexWithinWindow * effectiveDelay;
}

/**
 * Per-sender minimum delay lock using Redis SET NX PX.
 * Returns { acquired: true, remainingMs: 0 } if lock acquired,
 * or { acquired: false, remainingMs } with remaining TTL if held.
 */
export async function acquireSenderDelayLock(
  redisClient: IORedis.default,
  senderId: string,
  delayMs: number,
): Promise<{ acquired: boolean; remainingMs: number }> {
  if (delayMs <= 0) {
    return { acquired: true, remainingMs: 0 };
  }

  const lockKey = `sender:lock:${senderId}`;
  const setResult = await redisClient.set(lockKey, '1', 'PX', delayMs, 'NX');
  if (setResult === 'OK') {
    return { acquired: true, remainingMs: 0 };
  }

  const pttl = await redisClient.pttl(lockKey);
  return {
    acquired: false,
    remainingMs: pttl > 0 ? pttl : delayMs,
  };
}
