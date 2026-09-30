import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { config } from './config';
import type { Database } from './db/types';

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

let closed = false;
export async function closeDb(): Promise<void> {
  if (closed) return;
  closed = true;
  // Kysely's destroy() ends the pool via the PostgresDialect driver;
  // calling pool.end() as well logs "Called end on pool more than once".
  await db.destroy();
}
