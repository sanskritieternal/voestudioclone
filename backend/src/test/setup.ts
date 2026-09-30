/**
 * Integration test bootstrap.
 *
 * IMPORTANT: this module must be the first import in every test file, and
 * test files must not statically import anything else from src/ — ES module
 * evaluation order would otherwise load config.ts (via db.ts etc.) before
 * the test DATABASE_URL override below takes effect.
 *
 * Tests run against a disposable `veo_test` database and Redis db 1, so the
 * dev database is never touched.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';

function withDb(url: string, dbName: string): string {
  return url.replace(/\/[^/?]*(\?|$)/, `/${dbName}$1`);
}

const baseDb = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/veo';
process.env.DATABASE_URL = withDb(baseDb, 'veo_test');
const baseRedis = process.env.REDIS_URL ?? 'redis://localhost:6379/0';
process.env.REDIS_URL = baseRedis.replace(/\/\d*(\?|$)/, '/1$1');
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-only-secret-do-not-use-in-prod';
process.env.PROVIDER_MODE = 'stub';

let ready = false;
// Seed registry rows with their canonical (priority, enabled) from
// migrations 004_seed + 006_r3. truncateAll() restores these so registry
// admin tests (which reorder via priority swaps) are hermetic.
const SEED_REGISTRY: Array<{ id: string; priority: number; enabled: boolean }> = [
  { id: 'elevenlabs-tts', priority: 10, enabled: true },
  { id: 'gemini-tts', priority: 20, enabled: true },
  { id: 'gemini-llm', priority: 10, enabled: true },
  { id: 'gemini-image', priority: 10, enabled: true },
  { id: 'gemini-video', priority: 10, enabled: true },
  { id: 'ltx-video-fal', priority: 30, enabled: false },
  { id: 'hunyuan-video-repl', priority: 40, enabled: false },
  { id: 'qwen-llm-together', priority: 30, enabled: false },
  { id: 'qwen-image-together', priority: 30, enabled: false },
  { id: 'selfhosted-video', priority: 50, enabled: false },
  { id: 'flux-image-fal', priority: 30, enabled: false },
];
const SEED_REGISTRY_IDS = SEED_REGISTRY.map((r) => r.id);

/** Create veo_test if missing and run migrations against it (once per process). */
export async function initTestEnv(): Promise<void> {
  if (ready) return;
  const { Client } = await import('pg');
  const admin = new Client({ connectionString: withDb(process.env.DATABASE_URL!, 'postgres') });
  await admin.connect();
  try {
    const r = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', ['veo_test']);
    if (r.rowCount === 0) await admin.query('CREATE DATABASE veo_test');
  } finally {
    await admin.end();
  }
  const res = spawnSync(process.execPath, ['dist/migrate.js'], {
    env: { ...process.env },
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  if (res.status !== 0) {
    throw new Error(`test migrations failed:\n${res.stdout}\n${res.stderr}`);
  }
  // Snapshot seed registry ids so truncateAll() can remove test-added rows.
  ready = true;
}

type App = import('fastify').FastifyInstance;
let app: App | null = null;

/** Build the full Fastify app in-process (no network listen). */
export async function getApp(): Promise<App> {
  await initTestEnv();
  if (!app) {
    const { buildApp } = await import('../app');
    app = await buildApp();
  }
  return app;
}

/** Wipe all test data but keep seed rows (plans, provider_registry). */
export async function truncateAll(): Promise<void> {
  const { db } = await import('../db');
  const { redis } = await import('../redis');
  const tables = await db
    .selectFrom('pg_tables' as any)
    .select('tablename')
    .where('schemaname', '=', 'public')
    .execute();
  const skip = new Set(['schema_migrations', 'plans', 'provider_registry']);
  const names = (tables as any[])
    .map((t) => t.tablename as string)
    .filter((t) => !skip.has(t) && !t.startsWith('pg_') && !t.startsWith('sql_'));
  if (names.length > 0) {
    const { sql } = await import('kysely');
    await sql.raw(`TRUNCATE ${names.map((n) => `"${n}"`).join(', ')} RESTART IDENTITY CASCADE`).execute(db);
  }
  // provider_registry is seeded and shared: remove rows the tests added and
  // restore canonical priority/enabled on seed rows (move tests swap them).
  await db.deleteFrom('provider_registry').where('id', 'not in', SEED_REGISTRY_IDS).execute();
  for (const s of SEED_REGISTRY) {
    await db
      .updateTable('provider_registry')
      .set({ priority: s.priority, enabled: s.enabled })
      .where('id', '=', s.id)
      .execute();
  }
  await redis.flushdb();
}

export async function createUser(
  email: string,
  password = 'test-password-123',
  planId = 'personal-max-quality',
): Promise<{ id: string; email: string }> {
  const { db } = await import('../db');
  const { hashPassword } = await import('../services/auth');
  const row = await db
    .insertInto('users')
    .values({
      email: email.toLowerCase(),
      password_hash: await hashPassword(password),
      name: email.split('@')[0],
      plan_id: planId,
      email_verified: true,
    })
    .returning(['id', 'email'])
    .executeTakeFirstOrThrow();
  return { id: row.id, email: row.email };
}

export async function loginToken(app: App, email: string, password = 'test-password-123'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return (res.json() as any).token as string;
}

export function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Release everything so node --test processes exit cleanly. */
export async function closeTestEnv(): Promise<void> {
  if (app) {
    await app.close();
    app = null;
  }
  const { closeQueues } = await import('../queues');
  await closeQueues().catch(() => undefined);
  const { closeDb } = await import('../db');
  await closeDb().catch(() => undefined);
  const { redis } = await import('../redis');
  redis.disconnect();
}
