import type { FastifyReply, FastifyRequest } from 'fastify';
import { getPlan, type Plan } from '../services/plans';
import type { PlanFeatures } from '../db/types';

/** 403 unless the user's plan profile enables the feature. Server-side gating — never trust the client. */
export function requireFeature(feature: keyof PlanFeatures) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const plan = await getPlan((req.user as any)?.planId ?? null);
    if (!plan.features[feature]) {
      reply.code(403).send({ error: 'plan_gated', feature });
    }
  };
}

export async function planOf(req: FastifyRequest): Promise<Plan> {
  return getPlan((req.user as any)?.planId ?? null);
}
