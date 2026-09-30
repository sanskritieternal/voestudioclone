import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { config } from './config';
import type { Database } from './db/types';

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

export async function closeDb(): Promise<void> {
  await db.destroy();
  await pool.end();
}
