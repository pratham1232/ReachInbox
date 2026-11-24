import IORedis from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export const redis = new IORedis.default(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on('error', (err: Error) => {
  logger.error('Redis connection error', { error: err.message });
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

export function createBullMQConnection(): IORedis.default {
  return new IORedis.default(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
}
