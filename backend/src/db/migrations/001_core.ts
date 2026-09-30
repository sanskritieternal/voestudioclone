import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// 001 — identity, plans, quota ledger, projects
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('plans')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('slug', 'text', (c) => c.notNull().unique())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('price_inr', 'numeric')
    .addColumn('billing_period', 'text')
    .addColumn('limits', 'jsonb', (c) => c.notNull())
    .addColumn('features', 'jsonb', (c) => c.notNull())
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .execute();

  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'text', (c) => c.notNull().unique())
    .addColumn('password_hash', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('avatar_url', 'text')
    .addColumn('plan_id', 'text', (c) => c.references('plans.id'))
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('active'))
    .addColumn('email_verified', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_login_at', 'timestamptz')
    .execute();

  await db.schema
    .createTable('refresh_tokens')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('token_hash', 'text', (c) => c.notNull().unique())
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('revoked_at', 'timestamptz')
    .execute();
  await db.schema.createIndex('refresh_tokens_user_idx').on('refresh_tokens').column('user_id').execute();

  await db.schema
    .createTable('daily_usage')
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('day', 'date', (c) => c.notNull())
    .addColumn('tts_chars', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('images', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('scenes', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('niche_analyses', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('ai_tokens_in', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('ai_tokens_out', 'integer', (c) => c.notNull().defaultTo(0))
    .addPrimaryKeyConstraint('daily_usage_pk', ['user_id', 'day'])
    .execute();

  await db.schema
    .createTable('projects')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('type', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
    .addColumn('config', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('projects_user_idx').on('projects').columns(['user_id', 'created_at']).execute();
}
