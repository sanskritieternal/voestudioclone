import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// 006 — R3: reference list prices (USD estimates) on the provider registry
// rows, plus a fal.ai image row. Rows stay disabled until keys are set;
// adapters read cost_per_unit at chain-resolution time.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE provider_registry SET cost_per_unit = 0.35
    WHERE id = 'gemini-video' AND cost_per_unit IS NULL
  `.execute(db);
  await sql`
    UPDATE provider_registry SET cost_per_unit = 0.03
    WHERE id = 'gemini-image' AND cost_per_unit IS NULL
  `.execute(db);
  await sql`
    UPDATE provider_registry SET cost_per_unit = 0.05
    WHERE id = 'ltx-video-fal' AND cost_per_unit IS NULL
  `.execute(db);
  await sql`
    UPDATE provider_registry SET cost_per_unit = 0.08
    WHERE id = 'hunyuan-video-repl' AND cost_per_unit IS NULL
  `.execute(db);

  await sql`
    INSERT INTO provider_registry (id, name, capability, transport, priority, enabled, default_model, cost_per_unit, timeout_ms, config)
    VALUES
      ('flux-image-fal', 'flux', 'image', 'fal', 30, false, 'fal-ai/flux/schnell', 0.02, 180000, '{}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `.execute(db);
}
