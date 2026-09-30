import { db } from '../db';
import { redis } from '../redis';
import type { Plan } from './plans';

/**
 * Daily quota counters in Redis (atomic check-and-decrement via Lua).
 * Postgres `daily_usage` is the durable ledger, reconciled by workers.
 * For personal use these are spend guards, not paywalls.
 */

export interface QuotaUsage {
  tts_chars?: number;
  images?: number;
  scenes?: number;
  niche_analyses?: number;
  ai_tokens_in?: number;
  ai_tokens_out?: number;
}

const FIELD_TO_LIMIT: Record<keyof QuotaUsage, keyof Plan['limits']> = {
  tts_chars: 'tts_chars_daily',
  images: 'images_daily',
  scenes: 'scenes_daily',
  niche_analyses: 'niche_analyses_daily',
  ai_tokens_in: 'ai_tokens_daily',
  ai_tokens_out: 'ai_tokens_daily',
};

export function quotaKey(userId: string, day: string): string {
  return `quota:${userId}:${day}`;
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Seconds until server-local midnight (for the dashboard "resets in" label). */
export function secondsUntilReset(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(0, Math.round((midnight.getTime() - now.getTime()) / 1000));
}

const RESERVE_SCRIPT = `
local key = KEYS[1]
local n = #ARGV
local ttl = tonumber(ARGV[n])
for i = 1, n - 1, 3 do
  local field = ARGV[i]
  local amount = tonumber(ARGV[i+1])
  local limit = tonumber(ARGV[i+2])
  local used = tonumber(redis.call('HGET', key, field) or '0')
  if used + amount > limit then
    return field
  end
end
for i = 1, n - 1, 3 do
  redis.call('HINCRBY', key, ARGV[i], tonumber(ARGV[i+1]))
end
redis.call('EXPIRE', key, ttl)
return ''
`;

export type ReserveResult = { ok: true } | { ok: false; field: string; limit: number; used: number };

export async function reserveQuota(userId: string, plan: Plan, usage: QuotaUsage): Promise<ReserveResult> {
  const entries = (Object.entries(usage) as Array<[keyof QuotaUsage, number | undefined]>).filter(
    ([, v]) => v !== undefined && v > 0,
  ) as Array<[keyof QuotaUsage, number]>;
  if (entries.length === 0) return { ok: true };

  const argv: string[] = [];
  for (const [field, amount] of entries) {
    argv.push(field, String(amount), String(plan.limits[FIELD_TO_LIMIT[field]]));
  }
  argv.push('172800'); // 48h TTL

  const res = (await redis.eval(RESERVE_SCRIPT, 1, quotaKey(userId, todayStr()), ...argv)) as string;
  if (res === '') return { ok: true };
  const field = res as keyof QuotaUsage;
  const used = Number((await redis.hget(quotaKey(userId, todayStr()), field)) ?? '0');
  return { ok: false, field, limit: plan.limits[FIELD_TO_LIMIT[field]], used };
}

const RELEASE_SCRIPT = `
local key = KEYS[1]
for i = 1, #ARGV, 2 do
  local field = ARGV[i]
  local amount = tonumber(ARGV[i+1])
  local used = tonumber(redis.call('HGET', key, field) or '0')
  redis.call('HSET', key, field, math.max(0, used - amount))
end
return 1
`;

export async function releaseQuota(userId: string, usage: QuotaUsage): Promise<void> {
  const key = quotaKey(userId, todayStr());
  const args: string[] = [];
  for (const [field, amount] of Object.entries(usage)) {
    if (amount && amount > 0) args.push(field, String(amount));
  }
  if (args.length === 0) return;
  // R6: clamp at zero — a double release (or releasing more than reserved)
  // must never push usage negative and hand out free quota.
  await redis.eval(RELEASE_SCRIPT, 1, key, ...args);
}

export async function readQuotas(userId: string, plan: Plan) {
  const raw = await redis.hgetall(quotaKey(userId, todayStr()));
  const num = (f: string) => Number(raw[f] ?? '0');
  return {
    tts_chars: { used: num('tts_chars'), limit: plan.limits.tts_chars_daily },
    images: { used: num('images'), limit: plan.limits.images_daily },
    scenes: { used: num('scenes'), limit: plan.limits.scenes_daily },
    niche_analyses: { used: num('niche_analyses'), limit: plan.limits.niche_analyses_daily },
    ai_tokens_in: { used: num('ai_tokens_in'), limit: plan.limits.ai_tokens_daily },
    ai_tokens_out: { used: num('ai_tokens_out'), limit: plan.limits.ai_tokens_daily },
    resets_in: secondsUntilReset(),
  };
}

/** Reconcile the durable Postgres ledger from a quota reservation (called on job/TTS success). */
export async function reconcileUsage(userId: string, usage: Record<string, number> | null): Promise<void> {
  if (!usage) return;
  const get = (k: string) => usage[k] ?? 0;
  await db
    .insertInto('daily_usage')
    .values({
      user_id: userId, day: todayStr(),
      tts_chars: get('tts_chars'), images: get('images'), scenes: get('scenes'),
      niche_analyses: get('niche_analyses'), ai_tokens_in: get('ai_tokens_in'), ai_tokens_out: get('ai_tokens_out'),
    })
    .onConflict((oc) =>
      oc.columns(['user_id', 'day']).doUpdateSet((eb) => ({
        tts_chars: eb('daily_usage.tts_chars', '+', get('tts_chars')),
        images: eb('daily_usage.images', '+', get('images')),
        scenes: eb('daily_usage.scenes', '+', get('scenes')),
        niche_analyses: eb('daily_usage.niche_analyses', '+', get('niche_analyses')),
        ai_tokens_in: eb('daily_usage.ai_tokens_in', '+', get('ai_tokens_in')),
        ai_tokens_out: eb('daily_usage.ai_tokens_out', '+', get('ai_tokens_out')),
      })),
    )
    .execute();
}
