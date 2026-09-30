import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// 004 — seed routing profiles + provider registry (personal use)
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    INSERT INTO plans (id, slug, name, price_inr, billing_period, limits, features, is_active)
    VALUES
      ('personal-max-quality', 'personal-max-quality', 'Personal · Max Quality', NULL, NULL,
       '{"tts_chars_daily":100000,"images_daily":500,"scenes_daily":200,"niche_analyses_daily":200,"ai_tokens_daily":1000000,"threads":4,"max_video_minutes":10,"scenes_per_cycle":10}'::jsonb,
       '{"bulk_tools":true,"api_access":true,"priority_queue":true}'::jsonb, true),
      ('personal-eco', 'personal-eco', 'Personal · Eco', NULL, NULL,
       '{"tts_chars_daily":20000,"images_daily":100,"scenes_daily":50,"niche_analyses_daily":50,"ai_tokens_daily":200000,"threads":2,"max_video_minutes":5,"scenes_per_cycle":5}'::jsonb,
       '{"bulk_tools":true,"api_access":true,"priority_queue":false}'::jsonb, true)
    ON CONFLICT (id) DO NOTHING
  `.execute(db);

  // Registry: native providers enabled; API-transport rows disabled until keys are configured (R2/R3).
  await sql`
    INSERT INTO provider_registry (id, name, capability, transport, priority, enabled, default_model, timeout_ms, config)
    VALUES
      ('elevenlabs-tts', 'elevenlabs', 'tts', 'native', 10, true, 'eleven_multilingual_v2', 120000, '{}'::jsonb),
      ('gemini-llm',     'gemini',     'llm',   'native', 10, true, 'gemini-2.0-flash',        120000, '{}'::jsonb),
      ('gemini-image',   'gemini',     'image', 'native', 10, true, 'imagen-3.0-generate-002', 180000, '{}'::jsonb),
      ('gemini-video',   'gemini',     'video', 'native', 10, true, 'veo-2.0-generate-001',    600000, '{}'::jsonb),
      ('gemini-tts',     'gemini',     'tts',   'native', 20, true, 'gemini-2.0-flash-tts',    120000, '{}'::jsonb),
      ('ltx-video-fal',        'ltx',     'video', 'fal',         30, false, 'fal-ai/ltx-video', 600000, '{}'::jsonb),
      ('hunyuan-video-repl',   'hunyuan', 'video', 'replicate',   40, false, 'hunyuan-video',     600000, '{}'::jsonb),
      ('qwen-llm-together',    'qwen',    'llm',   'together',    30, false, 'Qwen/Qwen2.5-72B-Instruct-Turbo', 120000, '{}'::jsonb),
      ('qwen-image-together',  'qwen',    'image', 'together',    30, false, 'Qwen/Qwen2.5-VL-72B-Instruct',     180000, '{}'::jsonb),
      ('selfhosted-video', 'self-hosted', 'video', 'self-hosted', 50, false, NULL, 600000, '{}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `.execute(db);
}
