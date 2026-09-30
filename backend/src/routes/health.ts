import type { FastifyInstance } from 'fastify';
import { db } from '../db';
import { redis } from '../redis';

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true, service: 'veostudio-api' }));

  app.get('/ready', async (req, reply) => {
    try {
      await db.selectFrom('plans').select('id').limit(1).execute();
      await redis.ping();
      return { ok: true };
    } catch (err: any) {
      req.log.error({ err }, 'readiness check failed');
      return reply.code(503).send({ ok: false });
    }
  });
}
