import type { FastifyInstance } from 'fastify';
import { db } from '../db';

const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const;

/**
 * R5 — support tickets API.
 *
 * Personal-use ticket log: create tickets, change status, add replies.
 * Tickets are per-user; a reply bumps updated_at.
 */
export default async function supportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  async function ownTicket(userId: string, id: string) {
    return db.selectFrom('support_tickets').selectAll().where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();
  }

  // List (filter by status).
  app.get('/tickets', {
    schema: { querystring: { type: 'object', properties: { status: { type: 'string' } } } },
  }, async (req) => {
    const { status } = req.query as { status?: string };
    let q = db.selectFrom('support_tickets').selectAll().where('user_id', '=', req.user.id);
    if (status && (STATUSES as readonly string[]).includes(status)) q = q.where('status', '=', status);
    const tickets = await q.orderBy('updated_at', 'desc').execute();
    return { tickets };
  });

  // Create.
  app.post('/tickets', {
    schema: { body: { type: 'object', required: ['subject'], properties: { subject: { type: 'string', minLength: 1, maxLength: 200 }, body: { type: 'string', maxLength: 8000 } } } },
  }, async (req) => {
    const { subject, body } = req.body as { subject: string; body?: string };
    const ticket = await db
      .insertInto('support_tickets')
      .values({ user_id: req.user.id, subject: subject.trim(), body: body?.trim() ?? '' })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { ticket };
  });

  // View with replies.
  app.get('/tickets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ticket = await ownTicket(req.user.id, id);
    if (!ticket) return reply.code(404).send({ error: 'not_found' });
    const replies = await db
      .selectFrom('ticket_replies')
      .select(['id', 'body', 'created_at'])
      .where('ticket_id', '=', id)
      .orderBy('created_at', 'asc')
      .execute();
    return { ticket, replies };
  });

  // Change status.
  app.patch('/tickets/:id', {
    schema: { body: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: STATUSES as unknown as string[] } } } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { status } = req.body as { status: string };
    const ticket = await ownTicket(req.user.id, id);
    if (!ticket) return reply.code(404).send({ error: 'not_found' });
    const updated = await db
      .updateTable('support_tickets')
      .set({ status, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { ticket: updated };
  });

  // Add a reply.
  app.post('/tickets/:id/replies', {
    schema: { body: { type: 'object', required: ['body'], properties: { body: { type: 'string', minLength: 1, maxLength: 8000 } } } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { body } = req.body as { body: string };
    const ticket = await ownTicket(req.user.id, id);
    if (!ticket) return reply.code(404).send({ error: 'not_found' });
    const r = await db
      .insertInto('ticket_replies')
      .values({ ticket_id: id, user_id: req.user.id, body: body.trim() })
      .returning(['id', 'body', 'created_at'])
      .executeTakeFirstOrThrow();
    await db.updateTable('support_tickets').set({ updated_at: new Date() }).where('id', '=', id).execute();
    return { reply: r };
  });

  // Delete.
  app.delete('/tickets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ticket = await ownTicket(req.user.id, id);
    if (!ticket) return reply.code(404).send({ error: 'not_found' });
    await db.deleteFrom('support_tickets').where('id', '=', id).execute();
    return { ok: true };
  });
}
