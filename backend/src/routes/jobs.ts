import type { FastifyInstance } from 'fastify';
import { db } from '../db';
import { queues, queueForCapability } from '../queues';
import { jobShape } from '../services/jobs';
import type { JobStatus } from '../db/types';
import { releaseQuota } from '../services/quota';

export default async function jobRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const q = req.query as { status?: string; tool?: string; page?: string; pageSize?: string };
    const page = Math.max(1, parseInt(q.page ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10)));
    let sel = db.selectFrom('jobs').selectAll().where('user_id', '=', req.user.id);
    if (q.status) sel = sel.where('status', '=', q.status as JobStatus);
    if (q.tool) sel = sel.where('tool', '=', q.tool);
    const total = await sel.clearSelect().select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow();
    const rows = await sel.clearSelect().selectAll().orderBy('created_at', 'desc').limit(pageSize).offset((page - 1) * pageSize).execute();
    return { jobs: rows.map(jobShape), total: Number((total as any).n), page, pageSize };
  });

  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await db.selectFrom('jobs').selectAll().where('id', '=', id).where('user_id', '=', req.user.id).executeTakeFirst();
    if (!job) return reply.code(404).send({ error: 'not_found' });
    const artifacts = await db.selectFrom('artifacts').selectAll().where('job_id', '=', id).execute();
    return {
      job: jobShape(job),
      artifacts: artifacts.map((a) => ({ id: a.id, kind: a.kind, url: a.url, prompt: a.prompt, meta: a.meta, created_at: a.created_at })),
    };
  });

  app.post('/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await db.selectFrom('jobs').selectAll().where('id', '=', id).where('user_id', '=', req.user.id).executeTakeFirst();
    if (!job) return reply.code(404).send({ error: 'not_found' });
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return { job: jobShape(job), note: 'already terminal' };
    }
    // remove from BullMQ if still queued/active
    try {
      const q = queues[queueForCapability(job.capability)];
      const bjob = job.bullmq_job_id ? await q.getJob(job.bullmq_job_id) : null;
      if (bjob) await bjob.remove();
    } catch {
      // best effort; row update below is authoritative
    }
    if (job.quota_reserved) await releaseQuota(job.user_id, job.quota_reserved as Record<string, number>);
    const updated = await db
      .updateTable('jobs')
      .set({ status: 'cancelled', updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { job: jobShape(updated) };
  });
}
