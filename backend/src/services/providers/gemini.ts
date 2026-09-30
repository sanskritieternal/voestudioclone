import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { jobArtifactDir, downloadToFile, wrapPcmAsWav } from '../media';
import type { CapabilityProvider, ProviderCall, ProviderHandle, ProviderPoll, NewArtifact, Capability, RegistryRow } from '../providers';

/**
 * Real Gemini adapter (R3). Native transport for `video` (Veo), `image`
 * (Imagen), `llm` (generateContent) and `tts` (audio modality).
 *
 * Pricing below is a rough USD estimate for the Spend dashboard, not an invoice.
 *
 * Auth: GEMINI_API_KEY (or GOOGLE_API_KEY). When absent, submit() throws
 * `gemini_not_configured` so the provider chain falls through to the next
 * adapter instead of hard-failing.
 */

import { providerKey } from '../credentials';

const BASE = 'https://generativelanguage.googleapis.com';

async function apiKey(): Promise<string> {
  // DB credential (API Keys page) wins; GEMINI_API_KEY / GOOGLE_API_KEY env is the fallback.
  const k = await providerKey('gemini');
  if (!k) throw Object.assign(new Error('gemini_not_configured'), { code: 'gemini_not_configured' });
  return k;
}

async function gFetch(path: string, init: RequestInit = {}): Promise<any> {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(await apiKey())}`;
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as any;
      detail = j?.error?.message ?? JSON.stringify(j).slice(0, 300);
    } catch {
      detail = await res.text().catch(() => '').then((t) => t.slice(0, 300));
    }
    throw new Error(`gemini_${res.status}: ${detail || res.statusText}`);
  }
  return res.json();
}

// Cost estimates (USD). Veo 2 ~$0.35/sec 720p list; Imagen ~$0.03/image;
// Gemini 2.0 Flash ~$0.10/$0.40 per 1M in/out tokens; TTS ~$16/1M tokens.
const COST_VIDEO_PER_SEC = 0.35;
const COST_IMAGE_EACH = 0.03;

function aspectOf(params: Record<string, unknown>): string {
  const a = String(params.aspect_ratio ?? params.aspect ?? '16:9');
  return a === '9:16' || a === '9:16 ' ? '9:16' : '16:9';
}

function promptList(params: Record<string, unknown>): string[] {
  if (Array.isArray(params.prompts)) return (params.prompts as unknown[]).map(String).filter((s) => s.trim());
  if (typeof params.prompt === 'string' && params.prompt.trim()) return [params.prompt];
  return [''];
}

interface GenState {
  prompts: string[];
  idx: number;
  remoteOp: string | null; // in-flight operation name
  artifacts: NewArtifact[];
  cost: number;
  dir: string;
}

const states = new Map<string, GenState>();

export class GeminiProvider implements CapabilityProvider {
  readonly name: string;
  readonly capability: Capability;
  private readonly modelId: string;
  private readonly costPerUnit: number | null;

  constructor(readonly row: RegistryRow) {
    this.name = row.name;
    this.capability = row.capability as Capability;
    this.modelId = row.default_model ?? 'gemini-2.0-flash';
    this.costPerUnit = row.cost_per_unit == null ? null : Number(row.cost_per_unit);
  }

  private modelFor(params: Record<string, unknown>): string {
    const m = params.model;
    // Frontend model pickers send friendly labels ("Google Flow VEO") — only
    // honor values that look like real model ids.
    if (typeof m === 'string' && /^[a-z0-9][a-z0-9._-]{3,}$/i.test(m) && !/google flow/i.test(m)) return m;
    return this.modelId;
  }

  async submit(call: ProviderCall): Promise<ProviderHandle> {
    apiKey(); // fail fast so the chain can fall through
    const prompts = promptList(call.params);
    const { dir } = await jobArtifactDir(call.userId, call.jobId);
    const id = crypto.randomUUID();
    const count = this.capability === 'image' ? Math.min(8, prompts.length) : prompts.length;
    states.set(id, { prompts: prompts.slice(0, count), idx: 0, remoteOp: null, artifacts: [], cost: 0, dir });
    return { providerJobId: id, startedAt: Date.now() };
  }

  async poll(handle: ProviderHandle, call: ProviderCall): Promise<ProviderPoll> {
    const st = states.get(handle.providerJobId);
    if (!st) return { status: 'failed', error: 'gemini state lost' };
    const model = this.modelFor(call.params);

    try {
      if (this.capability === 'video') return await this.pollVideo(st, model, call);
      if (this.capability === 'image') return await this.pollImage(st, model, call);
      if (this.capability === 'llm') return await this.pollLlm(st, model, call);
      return await this.pollTts(st, model, call);
    } catch (err: any) {
      states.delete(handle.providerJobId);
      throw err;
    }
  }

  private progressOf(st: GenState): number {
    return Math.min(95, Math.round((st.idx / Math.max(1, st.prompts.length)) * 100));
  }

  /** Complete the job: drop local state, return all artifacts + total cost. */
  private finish(st: GenState): ProviderPoll {
    for (const [id, s] of states) if (s === st) states.delete(id);
    return { status: 'completed', artifacts: st.artifacts, costEstimate: st.cost };
  }

  // ---- Video (Veo): long-running operation ----
  private async pollVideo(st: GenState, model: string, call: ProviderCall): Promise<ProviderPoll> {
    const duration = Math.min(8, Math.max(1, Number(call.params.duration_seconds ?? 8)));
    if (!st.remoteOp) {
      const prompt = st.prompts[st.idx];
      const op = (await gFetch(`/v1beta/models/${model}:predictLongRunning`, {
        method: 'POST',
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { aspectRatio: aspectOf(call.params), durationSeconds: duration, personGeneration: 'allow_adult' },
        }),
      })) as { name: string };
      st.remoteOp = op.name;
      return { status: 'processing', progress: this.progressOf(st) + 2, pollInMs: 20_000 };
    }
    const op = (await gFetch(`/v1beta/${st.remoteOp}`)) as {
      done?: boolean;
      error?: { message?: string };
      response?: { generatedVideos?: Array<{ video?: { uri?: string } }> };
    };
    if (op.error) throw new Error(`gemini_video_failed: ${op.error.message ?? 'operation error'}`);
    if (!op.done) return { status: 'processing', progress: this.progressOf(st) + 5, pollInMs: 20_000 };
    const uri = op.response?.generatedVideos?.[0]?.video?.uri;
    if (!uri) throw new Error('gemini_video_failed: no video uri in completed operation');
    const fileName = `video-${st.idx + 1}.mp4`;
    await downloadToFile(uri, `${st.dir}/${fileName}`, { 'x-goog-api-key': await apiKey() });
    st.artifacts.push({
      kind: 'video',
      fileName,
      prompt: st.prompts[st.idx].slice(0, 500),
      meta: { provider: 'gemini', model, duration_seconds: duration, aspect_ratio: aspectOf(call.params) },
    });
    st.cost += duration * (this.costPerUnit ?? COST_VIDEO_PER_SEC);
    st.idx++;
    st.remoteOp = null;
    if (st.idx >= st.prompts.length) return this.finish(st);
    return { status: 'processing', progress: this.progressOf(st), pollInMs: 2000 };
  }

  // ---- Image (Imagen): one request per prompt ----
  private async pollImage(st: GenState, model: string, call: ProviderCall): Promise<ProviderPoll> {
    const prompt = st.prompts[st.idx];
    const j = (await gFetch(`/v1beta/models/${model}:predict`, {
      method: 'POST',
      body: JSON.stringify({
        instances: [{ prompt: call.params.style ? `${prompt}, style: ${call.params.style}` : prompt }],
        parameters: { sampleCount: 1, aspectRatio: aspectOf(call.params), outputMimeType: 'image/png' },
      }),
    })) as { predictions?: Array<{ bytesBase64Encoded?: string }> };
    const b64 = j.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) throw new Error('gemini_image_failed: no image bytes returned');
    const fileName = `image-${st.idx + 1}.png`;
    await fs.writeFile(`${st.dir}/${fileName}`, Buffer.from(b64, 'base64'));
    st.artifacts.push({
      kind: 'image',
      fileName,
      prompt: prompt.slice(0, 500),
      meta: { provider: 'gemini', model, aspect_ratio: aspectOf(call.params) },
    });
    st.cost += this.costPerUnit ?? COST_IMAGE_EACH;
    st.idx++;
    if (st.idx >= st.prompts.length) {
      for (const [id, s] of states) if (s === st) states.delete(id);
      return { status: 'completed', artifacts: st.artifacts, costEstimate: st.cost };
    }
    return { status: 'processing', progress: this.progressOf(st), pollInMs: 3000 };
  }

  // ---- LLM: single text response written to a .txt artifact ----
  private async pollLlm(st: GenState, model: string, call: ProviderCall): Promise<ProviderPoll> {
    const prompt = st.prompts[st.idx];
    const j = (await gFetch(`/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    })) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) throw new Error('gemini_llm_failed: empty response');
    const fileName = `llm-${st.idx + 1}.txt`;
    await fs.writeFile(`${st.dir}/${fileName}`, text);
    const inTok = Math.ceil(prompt.length / 4);
    const outTok = Math.ceil(text.length / 4);
    st.cost += (inTok * 0.1 + outTok * 0.4) / 1_000_000;
    st.artifacts.push({ kind: 'image', fileName, prompt: prompt.slice(0, 500), meta: { provider: 'gemini', model, kind: 'text' } });
    st.idx++;
    if (st.idx >= st.prompts.length) {
      for (const [id, s] of states) if (s === st) states.delete(id);
      return { status: 'completed', artifacts: st.artifacts, costEstimate: st.cost };
    }
    return { status: 'processing', progress: this.progressOf(st), pollInMs: 2000 };
  }

  // ---- TTS: audio modality, 24kHz PCM -> WAV ----
  private async pollTts(st: GenState, model: string, call: ProviderCall): Promise<ProviderPoll> {
    const text = st.prompts[st.idx];
    if (!text) return { status: 'failed', error: 'empty text' };
    const voiceName = String(call.params.voice_id ?? 'Kore');
    const j = (await gFetch(`/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Say naturally: ${text}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      }),
    })) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }> };
    const b64 = j.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64) throw new Error('gemini_tts_failed: no audio returned');
    const fileName = `tts-${st.idx + 1}.wav`;
    await wrapPcmAsWav(`${st.dir}/${fileName}`, Buffer.from(b64, 'base64'), 24000, 1);
    st.artifacts.push({ kind: 'audio', fileName, meta: { provider: 'gemini', model, voice: voiceName, chars: text.length } });
    st.cost += text.length * 0.000004; // ~$16/1M tokens estimate
    st.idx++;
    if (st.idx >= st.prompts.length) {
      for (const [id, s] of states) if (s === st) states.delete(id);
      return { status: 'completed', artifacts: st.artifacts, costEstimate: st.cost };
    }
    return { status: 'processing', progress: this.progressOf(st), pollInMs: 2000 };
  }
}
