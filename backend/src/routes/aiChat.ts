import type { FastifyInstance } from 'fastify';
import { db } from '../db';
import { planOf } from '../middleware/entitlement';
import { reserveQuota, releaseQuota, reconcileUsage } from '../services/quota';
import { chatComplete, titleFrom, type ChatMsg } from '../services/chat';

/**
 * R5 — AI chat API.
 *
 * Threads are per-user; messages are charged to the ai_tokens quota
 * (input reserved upfront from a chars/4 estimate, output reconciled after
 * the completion). No LLM configured → 503 llm_not_configured; the stub is
 * never used to fabricate a reply.
 */
export default async function aiChatRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  async function ownThread(userId: string, id: string) {
    return db.selectFrom('chat_threads').selectAll().where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();
  }

  // List threads (latest first) with message counts.
  app.get('/threads', async (req) => {
    const rows = await db
      .selectFrom('chat_threads')
      .leftJoin('chat_messages', 'chat_messages.thread_id', 'chat_threads.id')
      .select(['chat_threads.id', 'chat_threads.title', 'chat_threads.created_at'])
      .select((eb) => eb.fn.count('chat_messages.id').as('message_count'))
      .where('chat_threads.user_id', '=', req.user.id)
      .groupBy(['chat_threads.id', 'chat_threads.title', 'chat_threads.created_at'])
      .orderBy('chat_threads.created_at', 'desc')
      .execute();
    return { threads: rows };
  });

  // Create a thread.
  app.post('/threads', {
    schema: { body: { type: 'object', properties: { title: { type: 'string', maxLength: 120 } } } },
  }, async (req) => {
    const { title } = req.body as { title?: string };
    const row = await db
      .insertInto('chat_threads')
      .values({ user_id: req.user.id, title: title?.trim() || 'New chat' })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { thread: row };
  });

  // Get a thread with its messages.
  app.get('/threads/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const thread = await ownThread(req.user.id, id);
    if (!thread) return reply.code(404).send({ error: 'not_found' });
    const messages = await db
      .selectFrom('chat_messages')
      .select(['id', 'role', 'content', 'provider', 'created_at'])
      .where('thread_id', '=', id)
      .orderBy('created_at', 'asc')
      .execute();
    return { thread, messages };
  });

  // Delete a thread (cascades messages).
  app.delete('/threads/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const thread = await ownThread(req.user.id, id);
    if (!thread) return reply.code(404).send({ error: 'not_found' });
    await db.deleteFrom('chat_threads').where('id', '=', id).execute();
    return { ok: true };
  });

  // Send a message → assistant reply.
  app.post('/threads/:id/messages', {
    schema: { body: { type: 'object', required: ['content'], properties: { content: { type: 'string', minLength: 1, maxLength: 8000 } } } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { content } = req.body as { content: string };
    const thread = await ownThread(req.user.id, id);
    if (!thread) return reply.code(404).send({ error: 'not_found' });

    const prior = await db
      .selectFrom('chat_messages')
      .select(['role', 'content'])
      .where('thread_id', '=', id)
      .orderBy('created_at', 'asc')
      .execute();
    const history: ChatMsg[] = [
      ...prior.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content },
    ];

    // Reserve input tokens; output is reconciled after the completion.
    const estIn = Math.ceil(content.length / 4) + 120; // + system prompt
    const plan = await planOf(req);
    const res = await reserveQuota(req.user.id, plan, { ai_tokens_in: estIn });
    if (!res.ok) {
      return reply.code(429).send({ error: 'quota_exhausted', field: res.field, limit: res.limit, used: res.used });
    }

    const userMsg = await db
      .insertInto('chat_messages')
      .values({ thread_id: id, role: 'user', content })
      .returning('id')
      .executeTakeFirstOrThrow();

    try {
      const { text, provider, tokensIn, tokensOut } = await chatComplete(history, req.user.id);
      const assistant = await db
        .insertInto('chat_messages')
        .values({ thread_id: id, role: 'assistant', content: text, tokens_in: tokensIn, tokens_out: tokensOut, provider })
        .returning(['id', 'role', 'content', 'provider', 'created_at'])
        .executeTakeFirstOrThrow();
      // Refund the input over-reservation, then ledger the actuals.
      const over = Math.max(0, estIn - tokensIn);
      if (over > 0) await releaseQuota(req.user.id, { ai_tokens_in: over });
      await reconcileUsage(req.user.id, { ai_tokens_in: tokensIn, ai_tokens_out: tokensOut });
      // Auto-title from the first user message.
      if (thread.title === 'New chat') {
        await db.updateTable('chat_threads').set({ title: titleFrom(content) }).where('id', '=', id).execute();
      }
      return { message: assistant, tokens_in: tokensIn, tokens_out: tokensOut };
    } catch (err: any) {
      // Assistant failed: remove just-inserted user message so the thread stays clean.
      await releaseQuota(req.user.id, { ai_tokens_in: estIn });
      await db.deleteFrom('chat_messages').where('id', '=', userMsg.id).execute();
      const code = err?.code ?? '';
      if (code === 'llm_not_configured') {
        return reply.code(503).send({ error: 'llm_not_configured', message: 'Add a Gemini API key under API Keys → Provider integrations.' });
      }
      return reply.code(502).send({ error: 'chat_failed', message: err?.message ?? String(err) });
    }
  });
}
