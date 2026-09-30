import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { config } from '../../config';
import { jobArtifactDir, downloadToFile } from '../media';
import type { CapabilityProvider, ProviderCall, ProviderHandle, ProviderPoll, NewArtifact, Capability, RegistryRow } from '../providers';

/**
 * Generic HTTP API adapter (R3) for the queue/API transports:
 * `fal`, `replicate`, `together`, `self-hosted`.
 *
 * Each transport maps the generic ProviderCall onto the vendor's
 * submit → poll → download flow. Pricing comes from the registry row's
 * `cost_per_unit` (USD per video-second, or per image); null means the
 * Spend dashboard records units with no cost estimate.
 *
 * Auth comes from env (FAL_KEY, REPLICATE_API_TOKEN, TOGETHER_API_KEY,
 * SELF_HOSTED_API_KEY). A missing key throws `<transport>_not_configured`
 * so the chain falls through; any other error is fatal for the job.
 *
 * The `self-hosted` transport is fully config-driven via the row's `config`
 * jsonb — the escape hatch for any OpenAI-compatible or custom endpoint:
 *
 *   { "base_url": "http://gpu-box:8000",
 *     "auth": { "header": "Authorization", "scheme": "Bearer" },   // value from SELF_HOSTED_API_KEY
 *     "submit": { "method": "POST", "path": "/generate",
 *                 "body": { "prompt": "{prompt}", "aspect": "{aspect}" },
 *                 "id_path": "job_id" },
 *     "poll":   { "method": "GET", "path": "/status/{id}",
 *                 "status_path": "status", "done_value": "done",
 *                 "failed_values": ["error", "failed"], "result_path": "video_url" } }
 *
 * Templates support {prompt}, {aspect}, {model}, {id}. Paths use dotted
 * notation with [n] indices, e.g. "response.images[0].url".
 */

type Transport = 'fal' | 'replicate' | 'together' | 'self-hosted';

function notConfigured(transport: string): Error {
  return Object.assign(new Error(`${transport}_not_configured`), { code: `${transport}_not_configured` });
}

function keyFor(transport: Transport): string {
  const k =
    transport === 'fal' ? config.falKey
    : transport === 'replicate' ? config.replicateToken
    : transport === 'together' ? config.togetherKey
    : config.selfHostedKey;
  if (!k) throw notConfigured(transport);
  return k;
}

/** Dotted path with [n] indices, e.g. "response.images[0].url". */
export function getPath(obj: any, path: string): any {
  if (!path) return obj;
  let cur = obj;
  for (const seg of path.split('.')) {
    if (cur == null) return undefined;
    const m = /^([^\[]+)(?:\[(\d+)\])?$/.exec(seg);
    if (!m) return undefined;
    cur = cur[m[1]];
    if (m[2] !== undefined) cur = Array.isArray(cur) ? cur[Number(m[2])] : undefined;
  }
  return cur;
}

function fillTemplate(value: any, vars: Record<string, string>): any {
  if (typeof value === 'string') {
    return value.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
  }
  if (Array.isArray(value)) return value.map((v) => fillTemplate(v, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplate(v, vars)]));
  }
  return value;
}

function aspectOf(params: Record<string, unknown>): string {
  const a = String(params.aspect_ratio ?? params.aspect ?? '16:9');
  return a.startsWith('9:16') || a === 'portrait' ? '9:16' : '16:9';
}

function promptList(params: Record<string, unknown>, cap: Capability): string[] {
  let list: string[];
  if (Array.isArray(params.prompts)) list = (params.prompts as unknown[]).map(String).filter((s) => s.trim());
  else if (typeof params.prompt === 'string' && params.prompt.trim()) list = [params.prompt];
  else list = [''];
  return cap === 'image' ? list.slice(0, 8) : list;
}

interface ApiState {
  prompts: string[];
  idx: number;
  remoteId: string | null;
  artifacts: NewArtifact[];
  cost: number;
  dir: string;
}

const states = new Map<string, ApiState>();

export class HttpApiProvider implements CapabilityProvider {
  readonly name: string;
  readonly capability: Capability;
  private readonly transport: Transport;
  private readonly model: string;
  private readonly cfg: Record<string, any>;
  private readonly costPerUnit: number | null;

  constructor(readonly row: RegistryRow) {
    this.name = row.name;
    this.capability = row.capability as Capability;
    this.transport = row.transport as Transport;
    this.model = row.default_model ?? '';
    this.cfg = (row.config ?? {}) as Record<string, any>;
    this.costPerUnit = row.cost_per_unit == null ? null : Number(row.cost_per_unit);
  }

  async submit(call: ProviderCall): Promise<ProviderHandle> {
    keyFor(this.transport); // fail fast so the chain can fall through
    if (!this.model && this.transport !== 'self-hosted') {
      throw new Error(`${this.transport}_misconfigured: registry row has no default_model`);
    }
    const { dir } = await jobArtifactDir(call.userId, call.jobId);
    const id = crypto.randomUUID();
    states.set(id, { prompts: promptList(call.params, this.capability), idx: 0, remoteId: null, artifacts: [], cost: 0, dir });
    return { providerJobId: id, startedAt: Date.now() };
  }

  async poll(handle: ProviderHandle, call: ProviderCall): Promise<ProviderPoll> {
    const st = states.get(handle.providerJobId);
    if (!st) return { status: 'failed', error: `${this.transport} state lost` };
    try {
      if (this.transport === 'fal') return await this.pollFal(st, call);
      if (this.transport === 'replicate') return await this.pollReplicate(st, call);
      if (this.transport === 'together') return await this.pollTogether(st, call);
      return await this.pollSelfHosted(st, call);
    } catch (err: any) {
      states.delete(handle.providerJobId);
      throw err;
    }
  }

  private done(st: ApiState): ProviderPoll {
    for (const [id, s] of states) if (s === st) states.delete(id);
    return { status: 'completed', artifacts: st.artifacts, costEstimate: st.cost || null };
  }

  private progress(st: ApiState): number {
    return Math.min(95, Math.round((st.idx / Math.max(1, st.prompts.length)) * 100));
  }

  private addCost(st: ApiState, units: number): void {
    if (this.costPerUnit != null) st.cost += units * this.costPerUnit;
  }

  private async saveUrls(st: ApiState, urls: string[], kind: 'video' | 'image', prompt: string, model: string, headers: Record<string, string> = {}): Promise<void> {
    for (const url of urls) {
      const ext = kind === 'video' ? 'mp4' : url.match(/\.(png|jpe?g|webp)(\?|$)/i)?.[1]?.toLowerCase().replace('jpeg', 'jpg') ?? 'png';
      const fileName = `${kind}-${st.idx + 1}${urls.length > 1 ? `-${st.artifacts.length + 1}` : ''}.${ext}`;
      await downloadToFile(url, `${st.dir}/${fileName}`, headers);
      st.artifacts.push({ kind, fileName, prompt: prompt.slice(0, 500), meta: { provider: this.name, transport: this.transport, model } });
    }
  }

  private advance(st: ApiState): ProviderPoll | null {
    st.idx++;
    st.remoteId = null;
    if (st.idx >= st.prompts.length) return this.done(st);
    return null;
  }

  // ---------------------------------------------------------------- fal.ai
  private falBase(): string {
    return (this.cfg.base_url as string) ?? 'https://queue.fal.run';
  }

  private async pollFal(st: ApiState, call: ProviderCall): Promise<ProviderPoll> {
    const key = keyFor('fal');
    const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
    const prompt = st.prompts[st.idx];
    if (!st.remoteId) {
      const isVideo = this.capability === 'video';
      const input = isVideo
        ? { prompt, aspect_ratio: aspectOf(call.params), duration: String(Math.min(10, Math.max(1, Number(call.params.duration_seconds ?? 5)))) }
        : { prompt, image_size: aspectOf(call.params) === '9:16' ? 'portrait_4_3' : 'landscape_4_3', num_images: 1 };
      const res = await fetch(`${this.falBase()}/${this.model}`, { method: 'POST', headers, body: JSON.stringify(input) });
      if (!res.ok) throw new Error(`fal_${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j = (await res.json()) as { request_id: string };
      st.remoteId = j.request_id;
      return { status: 'processing', progress: this.progress(st) + 2, pollInMs: 8000 };
    }
    const sres = await fetch(`${this.falBase()}/requests/${st.remoteId}/status`, { headers });
    if (!sres.ok) throw new Error(`fal_status_${sres.status}`);
    const sj = (await sres.json()) as { status: string };
    if (sj.status === 'IN_QUEUE' || sj.status === 'IN_PROGRESS') {
      return { status: 'processing', progress: this.progress(st) + 5, pollInMs: 8000 };
    }
    if (sj.status !== 'COMPLETED') throw new Error(`fal_failed: status ${sj.status}`);
    const rres = await fetch(`${this.falBase()}/requests/${st.remoteId}`, { headers });
    const rj = (await rres.json()) as { response: any };
    const resp = rj.response ?? {};
    const urls: string[] = this.capability === 'video'
      ? [resp.video?.url ?? resp.url].filter(Boolean)
      : (resp.images ?? []).map((i: any) => i?.url).filter(Boolean);
    if (!urls.length) throw new Error('fal_failed: no media urls in response');
    await this.saveUrls(st, urls, this.capability as 'video' | 'image', prompt, this.model, headers);
    this.addCost(st, this.capability === 'video' ? Number(call.params.duration_seconds ?? 5) : 1);
    const fin = this.advance(st);
    return fin ?? { status: 'processing', progress: this.progress(st), pollInMs: 2000 };
  }

  // ------------------------------------------------------------ replicate
  private async pollReplicate(st: ApiState, call: ProviderCall): Promise<ProviderPoll> {
    const token = keyFor('replicate');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' };
    const prompt = st.prompts[st.idx];
    if (!st.remoteId) {
      const body: any = this.model.includes('/')
        ? { model: this.model, input: { prompt } }
        : { version: this.model, input: { prompt } };
      const res = await fetch('https://api.replicate.com/v1/predictions', { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`replicate_${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j = (await res.json()) as { id: string };
      st.remoteId = j.id;
      return { status: 'processing', progress: this.progress(st) + 2, pollInMs: 10_000 };
    }
    const res = await fetch(`https://api.replicate.com/v1/predictions/${st.remoteId}`, { headers });
    if (!res.ok) throw new Error(`replicate_status_${res.status}`);
    const j = (await res.json()) as { status: string; output?: string | string[]; error?: string };
    if (j.status === 'starting' || j.status === 'processing') {
      return { status: 'processing', progress: this.progress(st) + 5, pollInMs: 10_000 };
    }
    if (j.status !== 'succeeded') throw new Error(`replicate_failed: ${j.status}${j.error ? ` — ${j.error}` : ''}`);
    const urls = (Array.isArray(j.output) ? j.output : [j.output]).filter(Boolean) as string[];
    if (!urls.length) throw new Error('replicate_failed: empty output');
    await this.saveUrls(st, urls, this.capability as 'video' | 'image', prompt, this.model, headers);
    this.addCost(st, this.capability === 'video' ? Number(call.params.duration_seconds ?? 5) : 1);
    const fin = this.advance(st);
    return fin ?? { status: 'processing', progress: this.progress(st), pollInMs: 2000 };
  }

  // ------------------------------------------------------------- together
  private async pollTogether(st: ApiState, call: ProviderCall): Promise<ProviderPoll> {
    const key = keyFor('together');
    const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    const prompt = st.prompts[st.idx];
    if (this.capability === 'image') {
      const res = await fetch('https://api.together.xyz/v1/images/generations', {
        method: 'POST', headers,
        body: JSON.stringify({
          model: this.model, prompt,
          width: aspectOf(call.params) === '9:16' ? 768 : 1024,
          height: aspectOf(call.params) === '9:16' ? 1024 : 768,
          n: 1, response_format: 'url',
        }),
      });
      if (!res.ok) throw new Error(`together_${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j = (await res.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
      const item = j.data?.[0];
      if (item?.url) {
        await this.saveUrls(st, [item.url], 'image', prompt, this.model, headers);
      } else if (item?.b64_json) {
        const fileName = `image-${st.idx + 1}.png`;
        await fs.writeFile(`${st.dir}/${fileName}`, Buffer.from(item.b64_json, 'base64'));
        st.artifacts.push({ kind: 'image', fileName, prompt: prompt.slice(0, 500), meta: { provider: this.name, transport: 'together', model: this.model } });
      } else {
        throw new Error('together_failed: no image in response');
      }
      this.addCost(st, 1);
      const fin = this.advance(st);
      return fin ?? { status: 'processing', progress: this.progress(st), pollInMs: 2000 };
    }
    if (this.capability === 'llm') {
      const res = await fetch('https://api.together.xyz/v1/chat/completions', {
        method: 'POST', headers,
        body: JSON.stringify({ model: this.model, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) throw new Error(`together_${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = j.choices?.[0]?.message?.content ?? '';
      if (!text) throw new Error('together_failed: empty completion');
      const fileName = `llm-${st.idx + 1}.txt`;
      await fs.writeFile(`${st.dir}/${fileName}`, text);
      st.artifacts.push({ kind: 'image', fileName, prompt: prompt.slice(0, 500), meta: { provider: this.name, transport: 'together', model: this.model, kind: 'text' } });
      const fin = this.advance(st);
      return fin ?? { status: 'processing', progress: this.progress(st), pollInMs: 2000 };
    }
    throw new Error(`together_unsupported_capability: ${this.capability}`);
  }

  // ---------------------------------------------------------- self-hosted
  private async pollSelfHosted(st: ApiState, call: ProviderCall): Promise<ProviderPoll> {
    const key = keyFor('self-hosted');
    const base = String(this.cfg.base_url ?? '').replace(/\/$/, '');
    if (!base) throw new Error('self-hosted_misconfigured: config.base_url is required');
    const authCfg = (this.cfg.auth ?? {}) as { header?: string; scheme?: string };
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    headers[authCfg.header ?? 'Authorization'] = authCfg.scheme ? `${authCfg.scheme} ${key}` : key;
    const vars = { prompt: st.prompts[st.idx], aspect: aspectOf(call.params), model: this.model, id: st.remoteId ?? '' };

    if (!st.remoteId) {
      const sub = (this.cfg.submit ?? {}) as { method?: string; path?: string; body?: any; id_path?: string };
      const filled = fillTemplate(sub.body ?? { prompt: '{prompt}' }, vars);
      const res = await fetch(`${base}${fillTemplate(sub.path ?? '/generate', vars)}`, {
        method: sub.method ?? 'POST', headers, body: JSON.stringify(filled),
      });
      if (!res.ok) throw new Error(`self-hosted_${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j = await res.json();
      const id = getPath(j, sub.id_path ?? 'job_id');
      // Some endpoints are synchronous: they return the media directly.
      const direct = getPath(j, (this.cfg.poll as any)?.result_path ?? 'video_url');
      if (!id && typeof direct === 'string') {
        await this.saveUrls(st, [direct], this.capability === 'video' ? 'video' : 'image', vars.prompt, this.model, headers);
        this.addCost(st, 1);
        const fin = this.advance(st);
        return fin ?? { status: 'processing', progress: this.progress(st), pollInMs: 2000 };
      }
      if (!id) throw new Error('self-hosted_failed: no job id in submit response');
      st.remoteId = String(id);
      return { status: 'processing', progress: this.progress(st) + 2, pollInMs: 10_000 };
    }

    const pollCfg = (this.cfg.poll ?? {}) as { method?: string; path?: string; status_path?: string; done_value?: string; failed_values?: string[]; result_path?: string };
    const res = await fetch(`${base}${fillTemplate(pollCfg.path ?? '/status/{id}', vars)}`, { method: pollCfg.method ?? 'GET', headers });
    if (!res.ok) throw new Error(`self-hosted_status_${res.status}`);
    const j = await res.json();
    const status = String(getPath(j, pollCfg.status_path ?? 'status') ?? '');
    if ((pollCfg.failed_values ?? ['error', 'failed']).includes(status)) {
      throw new Error(`self-hosted_failed: status ${status}`);
    }
    if (status !== (pollCfg.done_value ?? 'done')) {
      return { status: 'processing', progress: this.progress(st) + 5, pollInMs: 10_000 };
    }
    const result = getPath(j, pollCfg.result_path ?? 'video_url');
    const urls = (Array.isArray(result) ? result : [result]).filter((u) => typeof u === 'string') as string[];
    if (!urls.length) throw new Error('self-hosted_failed: no media urls in result');
    await this.saveUrls(st, urls, this.capability === 'video' ? 'video' : 'image', vars.prompt, this.model, headers);
    this.addCost(st, 1);
    const fin = this.advance(st);
    return fin ?? { status: 'processing', progress: this.progress(st), pollInMs: 2000 };
  }
}
