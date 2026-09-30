import type { FastifyInstance } from 'fastify';
import { db } from '../db';

export default async function planRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // Personal use: routing profiles (quality-first vs eco), not purchasable tiers.
  app.get('/', async () => {
    const rows = await db.selectFrom('plans').selectAll().where('is_active', '=', true).orderBy('id').execute();
    return { plans: rows.map((p) => ({ id: p.id, slug: p.slug, name: p.name, limits: p.limits, features: p.features })) };
  });
}
