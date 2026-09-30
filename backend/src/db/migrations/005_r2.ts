import { sql } from 'kysely';
import type { Kysely } from 'kysely';

// 005 — R2: spend breakdowns + ElevenLabs cost seed
export async function up(db: Kysely<any>): Promise<void> {
  // Tool name on every cost row so the Spend dashboard can break down by tool.
  const hasTool = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'provider_cost_log' AND column_name = 'tool'
    ) AS exists
  `.execute(db);
  if (!hasTool.rows[0]?.exists) {
    await db.schema.alterTable('provider_cost_log').addColumn('tool', 'text').execute();
  }
  await db.schema
    .createIndex('provider_cost_log_tool_idx')
    .ifNotExists()
    .on('provider_cost_log')
    .columns(['user_id', 'tool', 'created_at'])
    .execute();

  // ElevenLabs TTS cost: ~$0.18 / 1k chars (creator tier). Stored as USD per char.
  await sql`
    UPDATE provider_registry
    SET cost_per_unit = 0.00018,
        config = config || '{"api_base":"https://api.elevenlabs.io","default_voice":"21m00Tcm4TlvDq8ikWAM"}'::jsonb
    WHERE id = 'elevenlabs-tts'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('provider_cost_log_tool_idx').ifExists().execute();
  await db.schema.alterTable('provider_cost_log').dropColumn('tool').execute();
}
