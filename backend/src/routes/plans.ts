import type { FastifyInstance } from 'fastify';
import { db } from '../db';

export default async function planRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // Personal use: routing profiles (quality-first vs eco), not purchasable tiers.
  app.get('/', async () => {
    const rows = await db.selectFrom('plans').selectAll().where('is_active', '=', true).orderBy('id').execute();
    return { plans: rows.map((p) => ({ id: p.id, slug: p.slug, name: p.name, limits: p.limits, features: p.features })) };
  });

  // Switch the current user's routing profile (personal use — no billing involved).
  app.post('/:id/switch', async (req, reply) => {
    const { id } = req.params as { id: string };
    const plan = await db.selectFrom('plans').selectAll().where('id', '=', id).where('is_active', '=', true).executeTakeFirst();
    if (!plan) return reply.code(404).send({ error: 'plan_not_found', message: 'Routing profile not found.' });
    const userId = (req as any).user.id as string;
    await db.updateTable('users').set({ plan_id: plan.id }).where('id', '=', userId).execute();
    return { ok: true, plan_id: plan.id, name: plan.name };
  });
}
