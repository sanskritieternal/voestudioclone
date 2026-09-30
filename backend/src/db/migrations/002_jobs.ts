import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// 002 — jobs + artifacts
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('jobs')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('project_id', 'uuid', (c) => c.references('projects.id').onDelete('set null'))
    .addColumn('tool', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('capability', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('queued'))
    .addColumn('progress', 'smallint', (c) => c.notNull().defaultTo(0))
    .addColumn('params', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('result', 'jsonb')
    .addColumn('error', 'text')
    .addColumn('quota_reserved', 'jsonb')
    .addColumn('attempts', 'smallint', (c) => c.notNull().defaultTo(0))
    .addColumn('bullmq_job_id', 'text')
    .addColumn('idempotency_key', 'text', (c) => c.unique())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('jobs_user_idx').on('jobs').columns(['user_id', 'created_at']).execute();
  await db.schema.createIndex('jobs_status_idx').on('jobs').column('status').execute();

  await db.schema
    .createTable('artifacts')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('job_id', 'uuid', (c) => c.references('jobs.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('url', 'text', (c) => c.notNull())
    .addColumn('prompt', 'text')
    .addColumn('meta', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('artifacts_job_idx').on('artifacts').column('job_id').execute();
  await db.schema.createIndex('artifacts_user_idx').on('artifacts').columns(['user_id', 'created_at']).execute();
}
