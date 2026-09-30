import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { db } from '../../db';
import { config } from '../../config';
import { jobArtifactDir, wrapPcmAsWav } from '../media';
import type { CapabilityProvider, ProviderCall, ProviderHandle, ProviderPoll, VoiceLab } from '../providers';

/**
 * Real ElevenLabs adapter (R2). Native transport for the `tts` capability.
 *
 * Covers: text-to-speech (sync PCM audio), voice catalog sync, sound
 * effects, voice design (text-to-voice) and voice cloning. Pricing notes
 * are estimates (USD) for the Spend dashboard, not invoices.
 *
 * Auth: provider_credentials store (API Keys page) first, ELEVENLABS_API_KEY
 * env as fallback. When the key is absent, submit()
 * throws `elevenlabs_not_configured` so the provider chain falls back to
 * the next adapter (stub in R1/R2) instead of hard-failing.
 */

import { providerKey } from '../credentials';

const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'; // Rachel (classic default)
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const COST_PER_CHAR_USD = 0.00018; // ~$0.18 / 1k chars, creator tier (estimate)

async function apiKey(): Promise<string> {
  // DB credential (API Keys page) wins; ELEVENLABS_API_KEY env is the fallback.
  const k = await providerKey('elevenlabs');
  if (!k) throw Object.assign(new Error('elevenlabs_not_configured'), { code: 'elevenlabs_not_configured' });
  return k;
}

async function elFetch(path: string, init: RequestInit & { voiceId?: string } = {}): Promise<Response> {
  const url = `${config.elevenlabsBase}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { 'xi-api-key': await apiKey(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as any;
      detail = j?.detail?.message ?? j?.detail ?? JSON.stringify(j).slice(0, 300);
    } catch {
      detail = await res.text().catch(() => '').then((t) => t.slice(0, 300));
    }
    throw new Error(`elevenlabs_${res.status}: ${detail || res.statusText}`);
  }
  return res;
}

/** Resolve a user-supplied voice reference to an ElevenLabs voice_id. */
export async function resolveVoiceId(voiceRef?: string): Promise<string> {
  if (!voiceRef) return DEFAULT_VOICE;
  // Our own voices row? (uuid id or provider_voice_id)
  const row = await db
    .selectFrom('voices')
    .select(['provider', 'provider_voice_id'])
    .where((eb: any) => eb.or([eb('id', '=', voiceRef as any), eb('provider_voice_id', '=', voiceRef)]))
    .executeTakeFirst()
    .catch(() => null);
  if (row?.provider_voice_id) return row.provider_voice_id;
  // Looks like a raw ElevenLabs voice id (20 alphanumerics) — pass through.
  if (/^[A-Za-z0-9]{20}$/.test(voiceRef)) return voiceRef;
  return DEFAULT_VOICE;
}

async function ttsToFile(text: string, voiceId: string, modelId: string, outPath: string): Promise<number> {
  const res = await elFetch(`/v1/text-to-speech/${voiceId}?output_format=pcm_44100`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: modelId }),
  });
  // PCM 44100 = raw 16-bit mono samples; wrap in a WAV header ourselves.
  const pcm = Buffer.from(await res.arrayBuffer());
  await wrapPcmAsWav(outPath, pcm, 44100, 1);
  return text.length;
}

export class ElevenLabsTtsProvider implements CapabilityProvider, VoiceLab {
  readonly name = 'elevenlabs';
  readonly capability = 'tts' as const;
  constructor(readonly modelId: string = DEFAULT_MODEL) {}

  async submit(_call: ProviderCall): Promise<ProviderHandle> {
    apiKey(); // fail fast so the chain can fall through
    return { providerJobId: crypto.randomUUID(), startedAt: Date.now() };
  }

  async poll(handle: ProviderHandle, call: ProviderCall): Promise<ProviderPoll> {
    const elapsed = Date.now() - handle.startedAt;
    if (elapsed < 1500) return { status: 'processing', progress: 20 };
    const text = String(call.params.text ?? '');
    if (!text) return { status: 'failed', error: 'empty text' };
    const prefix = String(call.params.artifact_prefix ?? 'tts');
    const voiceId = await resolveVoiceId(call.params.voice_id as string | undefined);
    const { dir } = await jobArtifactDir(call.userId, call.jobId);
    const outPath = `${dir}/${prefix}.wav`;
    const chars = await ttsToFile(text, voiceId, this.modelId, outPath);
    return {
      status: 'completed',
      artifacts: [{ kind: 'audio', fileName: `${prefix}.wav`, meta: { provider: 'elevenlabs', model: this.modelId, voice_id: voiceId, chars } }],
      costEstimate: chars * COST_PER_CHAR_USD,
    };
  }

  // ---- VoiceLab: segment synthesis (multi-character TTS) ----
  async synthSegment(text: string, voiceRef: string | undefined, outPath: string): Promise<{ chars: number; costEstimate: number }> {
    const voiceId = await resolveVoiceId(voiceRef);
    const chars = await ttsToFile(text, voiceId, this.modelId, outPath);
    return { chars, costEstimate: chars * COST_PER_CHAR_USD };
  }

  // ---- VoiceLab: sound effects ----
  async generateSfx(prompt: string, seconds: number, outPath: string): Promise<{ costEstimate: number }> {
    const res = await elFetch('/v1/sound-generation?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: prompt, duration_seconds: Math.min(30, Math.max(0.5, seconds)), prompt_influence: 0.3 }),
    });
    await fs.mkdir(outPath.split('/').slice(0, -1).join('/'), { recursive: true });
    await fs.writeFile(outPath, Buffer.from(await res.arrayBuffer()));
    return { costEstimate: seconds * 0.05 }; // ~$0.05/sec estimate
  }

  // ---- VoiceLab: voice design (text-to-voice, async on ElevenLabs side) ----
  async designVoice(p: { name: string; description: string; text: string }, outPath: string): Promise<{ designId: string | null; costEstimate: number }> {
    const created = (await (
      await elFetch('/v1/text-to-voice/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_name: p.name, voice_description: p.description, text: p.text }),
      })
    ).json()) as { generation_id: string };
    const deadline = Date.now() + 180_000;
    for (;;) {
      const st = (await (await elFetch(`/v1/text-to-voice/design/${created.generation_id}`)).json()) as {
        status: string;
        generated_audio?: string;
      };
      if (st.status === 'designed' && st.generated_audio) {
        const audio = await fetch(st.generated_audio);
        if (!audio.ok) throw new Error(`elevenlabs_design_download_${audio.status}`);
        await fs.mkdir(outPath.split('/').slice(0, -1).join('/'), { recursive: true });
        await fs.writeFile(outPath, Buffer.from(await audio.arrayBuffer()));
        return { designId: created.generation_id, costEstimate: p.text.length * COST_PER_CHAR_USD };
      }
      if (st.status === 'lost') throw new Error('elevenlabs_design_failed');
      if (Date.now() > deadline) throw new Error('elevenlabs_design_timeout');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // ---- VoiceLab: voice clone ----
  async cloneVoice(p: {
    name: string;
    description?: string;
    labels?: Record<string, string>;
    files: Array<{ filename: string; data: Buffer; contentType: string }>;
  }): Promise<{ voiceId: string }> {
    const form = new FormData();
    form.append('name', p.name);
    if (p.description) form.append('description', p.description);
    if (p.labels) form.append('labels', JSON.stringify(p.labels));
    for (const f of p.files) {
      form.append('files', new Blob([f.data], { type: f.contentType }), f.filename);
    }
    const res = await elFetch('/v1/voices/add', { method: 'POST', body: form as any });
    const j = (await res.json()) as { voice_id: string };
    return { voiceId: j.voice_id };
  }
}

// ---------------------------------------------------------------------------
// Voice catalog sync: ElevenLabs -> voices table (powers GET /api/voices)
// ---------------------------------------------------------------------------

interface ElVoice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string;
  preview_url?: string;
  labels?: Record<string, string>;
  verified_languages?: Array<{ language: string; model_id: string; accent: string }>;
}

export async function syncElevenLabsVoices(): Promise<{ fetched: number; upserted: number }> {
  apiKey();
  let next: string | null = null;
  let fetched = 0;
  let upserted = 0;
  for (;;) {
    const qs = new URLSearchParams({ include_total_count: 'true', page_size: '100' });
    if (next) qs.set('next_page_token', next);
    const page = (await (await elFetch(`/v1/voices?${qs}`)).json()) as { voices: ElVoice[]; next_page_token?: string };
    for (const v of page.voices ?? []) {
      const labels = v.labels ?? {};
      await db
        .insertInto('voices')
        .values({
          provider: 'elevenlabs',
          provider_voice_id: v.voice_id,
          name: v.name,
          gender: labels.gender ?? null,
          language: labels.language ?? v.verified_languages?.[0]?.language ?? 'en',
          country: null,
          preview_url: v.preview_url ?? null,
          meta: {
            category: v.category ?? null,
            description: v.description ?? null,
            labels,
            accent: labels.accent ?? null,
            verified_languages: (v.verified_languages ?? []).map((l) => l.language),
          },
          synced_at: new Date(),
        })
        .onConflict((oc: any) =>
          oc.column('provider_voice_id').doUpdateSet({
            name: (eb: any) => eb.ref('excluded.name'),
            gender: (eb: any) => eb.ref('excluded.gender'),
            language: (eb: any) => eb.ref('excluded.language'),
            preview_url: (eb: any) => eb.ref('excluded.preview_url'),
            meta: (eb: any) => eb.ref('excluded.meta'),
            synced_at: (eb: any) => eb.ref('excluded.synced_at'),
          }),
        )
        .execute();
      upserted++;
    }
    fetched += page.voices?.length ?? 0;
    next = page.next_page_token ?? null;
    if (!next) break;
  }
  return { fetched, upserted };
}
