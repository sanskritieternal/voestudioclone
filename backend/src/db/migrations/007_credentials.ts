import type { Kysely } from 'kysely';

// 007 — provider credentials: UI-managed API keys for provider integrations.
//
// Lets vaibhav paste provider keys (ElevenLabs, Gemini, fal.ai, Replicate,
// Together, self-hosted, YouTube) into the API Keys page instead of editing
// .env. Adapters resolve keys via services/credentials.ts: the DB value wins,
// the matching env var is the fallback. The API never returns key values —
// only a configured/not-configured flag plus the source (db | env).
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('provider_credentials')
    .addColumn('provider_name', 'text', (c) => c.primaryKey())
    .addColumn('api_key', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo('now()'))
    .execute();
}
