import type { FastifyReply, FastifyRequest } from 'fastify';
import { redis } from '../redis';

interface RateLimitOpts {
  windowSec: number;
  max: number;
  key: (req: FastifyRequest) => string;
}

/** Tiny fixed-window limiter on Redis (shared across API processes). */
export function rateLimit(opts: RateLimitOpts) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const window = Math.floor(Date.now() / 1000 / opts.windowSec);
    const k = `rl:${opts.key(req)}:${window}`;
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, opts.windowSec);
    if (n > opts.max) {
      reply.code(429).send({ error: 'rate_limited', retry_after_sec: opts.windowSec });
      return;
    }
  };
}

/** Per-user limiter applied after authentication (wired in app.ts). */
export const authedLimiter = rateLimit({
  windowSec: 60,
  max: 120,
  key: (req) => `user:${(req.user as any)?.id ?? req.ip}`,
});

/**
 * R6 — burst guard for the expensive endpoints (LLM chat, sync TTS/SFX,
 * YouTube analyses, voice design/clone). Quota already gates daily spend;
 * this stops runaway loops minute-to-minute. Wired per-route AFTER the
 * app-level authenticate hook, so req.user is available for the key.
 */
export const expensiveLimiter = rateLimit({
  windowSec: 60,
  max: 30,
  key: (req) => `expensive:${(req.user as any)?.id ?? req.ip}`,
});
