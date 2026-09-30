import type { FastifyInstance } from 'fastify';
import { db } from '../db';
import { jobShape } from '../services/jobs';

const createSchema = {
  body: {
    type: 'object',
    required: ['type', 'name'],
    properties: {
      type: { type: 'string', minLength: 1, maxLength: 64 },
      name: { type: 'string', minLength: 1, maxLength: 200 },
      config: { type: 'object' },
    },
  },
};

function projectShape(p: any) {
  return { id: p.id, type: p.type, name: p.name, status: p.status, config: p.config, created_at: p.created_at, updated_at: p.updated_at };
}

export default async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const q = req.query as { type?: string; status?: string; q?: string; page?: string; pageSize?: string };
    const page = Math.max(1, parseInt(q.page ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10)));
    let sel = db.selectFrom('projects').selectAll().where('user_id', '=', req.user.id);
    if (q.type) sel = sel.where('type', '=', q.type);
    if (q.status) sel = sel.where('status', '=', q.status);
    if (q.q) sel = sel.where('name', 'ilike', `%${q.q}%`);
    const total = await sel.clearSelect().select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow();
    const rows = await sel
      .clearSelect()
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .execute();
    return { projects: rows.map(projectShape), total: Number((total as any).n), page, pageSize };
  });

  app.get('/templates', async () => {
    // Viral-niche project templates land here in R2.
    return { templates: [] };
  });

  app.post('/', { schema: createSchema }, async (req, reply) => {
    const { type, name, config } = req.body as { type: string; name: string; config?: Record<string, unknown> };
    const row = await db
      .insertInto('projects')
      .values({ user_id: req.user.id, type, name, config: config ?? {} })
      .returningAll()
      .executeTakeFirstOrThrow();
    return reply.code(201).send({ project: projectShape(row) });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await db.selectFrom('projects').selectAll().where('id', '=', id).where('user_id', '=', req.user.id).executeTakeFirst();
    if (!project) return reply.code(404).send({ error: 'not_found' });
    const jobs = await db.selectFrom('jobs').selectAll().where('project_id', '=', id).orderBy('created_at', 'desc').limit(50).execute();
    return { project: projectShape(project), jobs: jobs.map(jobShape) };
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { name, status, config } = req.body as { name?: string; status?: string; config?: Record<string, unknown> };
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (name !== undefined) patch.name = name;
    if (status !== undefined) patch.status = status;
    if (config !== undefined) patch.config = config;
    const row = await db.updateTable('projects').set(patch).where('id', '=', id).where('user_id', '=', req.user.id).returningAll().executeTakeFirst();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { project: projectShape(row) };
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await db.deleteFrom('projects').where('id', '=', id).where('user_id', '=', req.user.id).executeTakeFirst();
    if (Number(res.numDeletedRows) === 0) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
}
