import Redis from 'ioredis';
import { config } from './config';

/**
 * Fresh Redis client. BullMQ requires maxRetriesPerRequest: null,
 * so every consumer gets its own client (queues, workers, quota/cache).
 */
export function createRedis(): Redis {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

/** Shared client for quota counters, rate limiting, cache. */
export const redis = createRedis();
