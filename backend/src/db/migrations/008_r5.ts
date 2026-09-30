import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// 008 — R5 personal platform: AI chat threads/messages, support tickets + replies.
//
// chat_threads / chat_messages back the AI Chat page. Token counts are
// estimated (chars/4) when the provider doesn't report usage; they feed the
// dashboard's token cards via the daily_usage ledger (ai_tokens_in/out).
// support_tickets (+ ticket_replies) back the Support page. For personal use
// this is a simple log, but the schema supports the full lifecycle.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('chat_threads')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('title', 'text', (c) => c.notNull().defaultTo('New chat'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo('now()'))
    .execute();
  await db.schema.createIndex('chat_threads_user_idx').on('chat_threads').column('user_id').execute();

  await db.schema
    .createTable('chat_messages')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('thread_id', 'uuid', (c) => c.notNull().references('chat_threads.id').onDelete('cascade'))
    .addColumn('role', 'text', (c) => c.notNull()) // 'user' | 'assistant'
    .addColumn('content', 'text', (c) => c.notNull())
    .addColumn('tokens_in', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('tokens_out', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('provider', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo('now()'))
    .execute();
  await db.schema.createIndex('chat_messages_thread_idx').on('chat_messages').column('thread_id').execute();

  await db.schema
    .createTable('support_tickets')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('subject', 'text', (c) => c.notNull())
    .addColumn('body', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('open')) // open | in_progress | waiting | resolved | closed
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo('now()'))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo('now()'))
    .execute();
  await db.schema.createIndex('support_tickets_user_idx').on('support_tickets').column('user_id').execute();

  await db.schema
    .createTable('ticket_replies')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('ticket_id', 'uuid', (c) => c.notNull().references('support_tickets.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('body', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo('now()'))
    .execute();
  await db.schema.createIndex('ticket_replies_ticket_idx').on('ticket_replies').column('ticket_id').execute();
}
