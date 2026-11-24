import { describe, expect, it } from 'vitest';
import type IORedis from 'ioredis';
import {
  acquireHourlyRateLimit,
  acquireSenderDelayLock,
  computeRescheduleTimestampMs,
  getHourWindowInfo,
} from '../rateLimiter.js';

/**
 * In-memory Redis mock implementing the exact Lua atomic rate-limit check + SET NX PX lock
 * so unit tests can verify atomicity, window rollover, and lock behavior deterministically.
 */
function createMockRedis() {
  const store = new Map<string, { value: string; expiresAt: number }>();

  const isExpired = (key: string, now = Date.now()) => {
    const entry = store.get(key);
    if (!entry) return true;
    if (entry.expiresAt > 0 && now >= entry.expiresAt) {
      store.delete(key);
      return true;
    }
    return false;
  };

  return {
    eval: async (
      _script: string,
      _numKeys: number,
      senderKey: string,
      globalKey: string,
      senderLimitStr: string,
      globalLimitStr: string,
      ttlStr: string,
    ) => {
      const senderLimit = Number(senderLimitStr);
      const globalLimit = Number(globalLimitStr);
      const ttlMs = Number(ttlStr) * 1000;
      const now = Date.now();

      const senderVal = isExpired(senderKey, now)
        ? 0
        : Number(store.get(senderKey)!.value);
      if (senderVal >= senderLimit) {
        return [0, senderVal, 'sender'];
      }

      if (globalLimit > 0) {
        const globalVal = isExpired(globalKey, now)
          ? 0
          : Number(store.get(globalKey)!.value);
        if (globalVal >= globalLimit) {
          return [0, globalVal, 'global'];
        }
      }

      const nextSender = senderVal + 1;
      store.set(senderKey, {
        value: String(nextSender),
        expiresAt:
          senderVal === 0
            ? now + ttlMs
            : (store.get(senderKey)?.expiresAt ?? now + ttlMs),
      });

      if (globalLimit > 0) {
        const globalVal = isExpired(globalKey, now)
          ? 0
          : Number(store.get(globalKey)!.value);
        const nextGlobal = globalVal + 1;
        store.set(globalKey, {
          value: String(nextGlobal),
          expiresAt:
            globalVal === 0
              ? now + ttlMs
              : (store.get(globalKey)?.expiresAt ?? now + ttlMs),
        });
      }

      return [1, nextSender, 'ok'];
    },
    set: async (key: string, value: string, _px: string, ms: number, _nx: string) => {
      const now = Date.now();
      if (!isExpired(key, now)) {
        return null;
      }
      store.set(key, { value, expiresAt: now + ms });
      return 'OK';
    },
    pttl: async (key: string) => {
      const entry = store.get(key);
      if (!entry) return -2;
      return Math.max(0, entry.expiresAt - Date.now());
    },
  } as unknown as IORedis.default;
}

describe('rateLimiter', () => {
  it('enforces atomic per-sender hourly limit without over-incrementing on rejection', async () => {
    const mockRedis = createMockRedis();
    const nowMs = Date.UTC(2026, 10, 24, 10, 15, 0);

    // Concurrent burst of 5 calls with limit = 3
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        acquireHourlyRateLimit(mockRedis, {
          senderId: 'sender-1',
          senderHourlyLimit: 3,
          globalHourlyLimit: 100,
          nowMs,
        }),
      ),
    );

    const allowedCount = results.filter((r) => r.allowed).length;
    const rejectedCount = results.filter((r) => !r.allowed).length;

    expect(allowedCount).toBe(3);
    expect(rejectedCount).toBe(2);
    expect(results.every((r) => r.hourWindow === '2026-11-24T10')).toBe(true);
  });

  it('rolls over cleanly into the next hour window', async () => {
    const mockRedis = createMockRedis();
    const hour1 = Date.UTC(2026, 10, 24, 10, 59, 50);
    const hour2 = Date.UTC(2026, 10, 24, 11, 0, 5);

    const r1 = await acquireHourlyRateLimit(mockRedis, {
      senderId: 'sender-rollover',
      senderHourlyLimit: 1,
      globalHourlyLimit: 100,
      nowMs: hour1,
    });
    const r2 = await acquireHourlyRateLimit(mockRedis, {
      senderId: 'sender-rollover',
      senderHourlyLimit: 1,
      globalHourlyLimit: 100,
      nowMs: hour1,
    });
    const r3 = await acquireHourlyRateLimit(mockRedis, {
      senderId: 'sender-rollover',
      senderHourlyLimit: 1,
      globalHourlyLimit: 100,
      nowMs: hour2,
    });

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(false);
    expect(r3.allowed).toBe(true);
    expect(r3.hourWindow).toBe('2026-11-24T11');
  });

  it('computes deterministic reschedule timestamps preserving sequence order across windows', () => {
    const { nextHourStartMs } = getHourWindowInfo(Date.UTC(2026, 10, 24, 10, 30, 0));
    const hourlyLimit = 100;
    const minDelayMs = 2000;

    const t100 = computeRescheduleTimestampMs({
      nextHourStartMs,
      sequenceIndex: 100,
      minDelayMs,
      hourlyLimit,
    });
    const t101 = computeRescheduleTimestampMs({
      nextHourStartMs,
      sequenceIndex: 101,
      minDelayMs,
      hourlyLimit,
    });
    const t200 = computeRescheduleTimestampMs({
      nextHourStartMs,
      sequenceIndex: 200,
      minDelayMs,
      hourlyLimit,
    });

    expect(t100).toBe(nextHourStartMs);
    expect(t101).toBe(nextHourStartMs + 2000);
    expect(t200).toBe(nextHourStartMs + 3600 * 1000);
    expect(t100).toBeLessThan(t101);
    expect(t101).toBeLessThan(t200);
  });

  it('enforces per-sender minimum delay lock with remaining TTL', async () => {
    const mockRedis = createMockRedis();
    const first = await acquireSenderDelayLock(mockRedis, 'sender-lock-1', 2000);
    const second = await acquireSenderDelayLock(mockRedis, 'sender-lock-1', 2000);

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(second.remainingMs).toBeGreaterThan(0);
    expect(second.remainingMs).toBeLessThanOrEqual(2000);
  });
});
