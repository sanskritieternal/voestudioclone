import { db } from '../db';
import type { PlanFeatures, PlanLimits } from '../db/types';

export interface Plan {
  id: string;
  slug: string;
  name: string;
  limits: PlanLimits;
  features: PlanFeatures;
}

const DEFAULT_LIMITS: PlanLimits = {
  tts_chars_daily: 100000,
  images_daily: 500,
  scenes_daily: 200,
  niche_analyses_daily: 200,
  ai_tokens_daily: 1000000,
  threads: 4,
  max_video_minutes: 10,
  scenes_per_cycle: 10,
};

const DEFAULT_FEATURES: PlanFeatures = { bulk_tools: true, api_access: true, priority_queue: true };

const cache = new Map<string, { plan: Plan; at: number }>();
const CACHE_TTL_MS = 60_000;

export async function getPlan(planId: string | null): Promise<Plan> {
  const key = planId ?? 'personal-max-quality';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.plan;

  const row = await db.selectFrom('plans').selectAll().where('id', '=', key).executeTakeFirst();
  const plan: Plan = row
    ? { id: row.id, slug: row.slug, name: row.name, limits: row.limits, features: row.features }
    : { id: key, slug: key, name: key, limits: DEFAULT_LIMITS, features: DEFAULT_FEATURES };

  cache.set(key, { plan, at: Date.now() });
  return plan;
}

export function clearPlanCache(): void {
  cache.clear();
}
