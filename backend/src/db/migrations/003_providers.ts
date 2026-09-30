import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// 003 — provider registry, cost log, voices, youtube cache, api keys
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('provider_registry')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('capability', 'text', (c) => c.notNull())
    .addColumn('transport', 'text', (c) => c.notNull())
    .addColumn('priority', 'integer', (c) => c.notNull().defaultTo(100))
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('endpoint', 'text')
    .addColumn('auth_ref', 'text')
    .addColumn('default_model', 'text')
    .addColumn('request_map', 'text')
    .addColumn('cost_per_unit', 'numeric')
    .addColumn('timeout_ms', 'integer', (c) => c.notNull().defaultTo(120000))
    .addColumn('config', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .execute();

  await db.schema
    .createTable('provider_cost_log')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('job_id', 'uuid', (c) => c.references('jobs.id').onDelete('set null'))
    .addColumn('provider', 'text', (c) => c.notNull())
    .addColumn('capability', 'text', (c) => c.notNull())
    .addColumn('units', 'numeric', (c) => c.notNull())
    .addColumn('cost_estimate', 'numeric')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('provider_cost_log_user_idx').on('provider_cost_log').columns(['user_id', 'created_at']).execute();

  await db.schema
    .createTable('voices')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('provider', 'text', (c) => c.notNull())
    .addColumn('provider_voice_id', 'text', (c) => c.notNull().unique())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('gender', 'text')
    .addColumn('language', 'text')
    .addColumn('country', 'text')
    .addColumn('preview_url', 'text')
    .addColumn('meta', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('synced_at', 'timestamptz')
    .execute();
  await db.schema.createIndex('voices_lang_idx').on('voices').column('language').execute();

  await db.schema
    .createTable('youtube_analyses')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('input', 'jsonb', (c) => c.notNull())
    .addColumn('result', 'jsonb', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('youtube_analyses_user_idx').on('youtube_analyses').columns(['user_id', 'kind']).execute();

  await db.schema
    .createTable('api_keys')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('key_hash', 'text', (c) => c.notNull().unique())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('scopes', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'::text[]`))
    .addColumn('last_used_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}
