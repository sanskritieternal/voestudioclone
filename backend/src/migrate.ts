import { Kysely, sql } from 'kysely';
import { db } from './db';
import * as m001 from './db/migrations/001_core';
import * as m002 from './db/migrations/002_jobs';
import * as m003 from './db/migrations/003_providers';
import * as m004 from './db/migrations/004_seed';
import * as m005 from './db/migrations/005_r2';
import * as m006 from './db/migrations/006_r3';

const MIGRATIONS: Array<{ name: string; up: (db: Kysely<any>) => Promise<void> }> = [
  { name: '001_core', up: m001.up },
  { name: '002_jobs', up: m002.up },
  { name: '003_providers', up: m003.up },
  { name: '004_seed', up: m004.up },
  { name: '005_r2', up: m005.up },
  { name: '006_r3', up: m006.up },
];

async function migrate(): Promise<void> {
  await db.schema
    .createTable('schema_migrations')
    .addColumn('name', 'text', (c) => c.primaryKey())
    .addColumn('applied_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute()
    .catch(() => undefined);

  const applied = await db.selectFrom('schema_migrations').select('name').execute();
  const appliedSet = new Set(applied.map((r) => r.name));

  for (const m of MIGRATIONS) {
    if (appliedSet.has(m.name)) {
      console.log(`  skip ${m.name}`);
      continue;
    }
    console.log(`  apply ${m.name}`);
    await db.transaction().execute(async (trx) => {
      await m.up(trx as unknown as Kysely<any>);
      await trx.insertInto('schema_migrations').values({ name: m.name }).execute();
    });
  }
  console.log('migrations done');
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('migration failed:', err);
    process.exit(1);
  });
