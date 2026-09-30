import crypto from 'node:crypto';
import { db } from '../db';
import { config } from '../config';
import { jobArtifactDir, writeSlateSvg, writeSilentWav } from './media';

/**
 * Provider abstraction (blueprint §5.4).
 *
 * Capabilities: tts | video | image | llm. Each request resolves to an
 * ordered provider chain from `provider_registry`; the worker walks the
 * chain on failure. R1 ships the StubProvider so the whole pipeline is
 * testable end-to-end; live adapters (ElevenLabs/Gemini/fal/Replicate/
 * Together/self-hosted) land in R2/R3 behind the same interface.
 */

export type Capability = 'tts' | 'video' | 'image' | 'llm';

export interface ProviderCall {
  capability: Capability;
  tool: string;
  params: Record<string, unknown>;
  userId: string;
  jobId: string;
}

export interface ProviderHandle {
  providerJobId: string;
  startedAt: number;
}

export interface NewArtifact {
  kind: 'audio' | 'image' | 'video';
  fileName: string;
  prompt?: string;
  meta?: Record<string, unknown>;
}

export type ProviderPoll =
  | { status: 'processing'; progress: number }
  | { status: 'completed'; artifacts: NewArtifact[]; costEstimate?: number; raw?: unknown }
  | { status: 'failed'; error: string };

export interface CapabilityProvider {
  readonly name: string;
  readonly capability: Capability;
  submit(call: ProviderCall): Promise<ProviderHandle>;
  poll(handle: ProviderHandle, call: ProviderCall): Promise<ProviderPoll>;
}

/** Local fake: completes after a few seconds, writes viewable stub artifacts. */
export class StubProvider implements CapabilityProvider {
  readonly name = 'stub';
  constructor(readonly capability: Capability) {}

  async submit(_call: ProviderCall): Promise<ProviderHandle> {
    return { providerJobId: crypto.randomUUID(), startedAt: Date.now() };
  }

  async poll(handle: ProviderHandle, call: ProviderCall): Promise<ProviderPoll> {
    const elapsed = Date.now() - handle.startedAt;
    const targetMs = call.capability === 'video' ? 12000 : call.capability === 'image' ? 6000 : 3000;
    if (elapsed < targetMs) {
      return { status: 'processing', progress: Math.min(95, Math.round((elapsed / targetMs) * 100)) };
    }
    const { dir, urlPrefix } = await jobArtifactDir(call.userId, call.jobId);
    const artifacts: NewArtifact[] = [];

    if (call.capability === 'tts') {
      const text = String(call.params.text ?? '');
      const seconds = Math.min(120, Math.max(2, Math.round(text.length / 14)));
      await writeSilentWav(`${dir}/tts.wav`, seconds);
      artifacts.push({ kind: 'audio', fileName: 'tts.wav', meta: { stub: true, seconds, chars: text.length } });
      void urlPrefix;
    } else {
      const prompts = Array.isArray(call.params.prompts) ? (call.params.prompts as unknown[]) : [];
      const count = call.capability === 'image' ? Math.min(8, Math.max(1, prompts.length || Number(call.params.count ?? 1))) : 1;
      for (let i = 0; i < count; i++) {
        const fileName = `${call.capability}-${i + 1}.svg`;
        await writeSlateSvg(
          `${dir}/${fileName}`,
          `STUB ${call.capability.toUpperCase()} — ${call.tool}`,
          [`provider: stub (PROVIDER_MODE=stub)`, `prompt: ${String(call.params.prompt ?? call.params.prompts ?? '').slice(0, 60)}`, `live adapters land in R2/R3`],
        );
        artifacts.push({ kind: call.capability === 'image' ? 'image' : 'video', fileName, meta: { stub: true } });
      }
    }
    return { status: 'completed', artifacts, costEstimate: 0 };
  }
}

export interface RegistryRow {
  id: string;
  name: string;
  capability: string;
  transport: string;
  priority: number;
  enabled: boolean;
}

/**
 * Resolve the provider chain for a capability. In stub mode (R1) this
 * always yields a StubProvider; in live mode it instantiates adapters
 * for enabled registry rows ordered by priority (R2/R3).
 */
export async function resolveProviders(capability: Capability, _tool: string): Promise<CapabilityProvider[]> {
  if (config.providerMode === 'stub') return [new StubProvider(capability)];

  const rows = (await db
    .selectFrom('provider_registry')
    .select(['id', 'name', 'capability', 'transport', 'priority', 'enabled'])
    .where('capability', '=', capability)
    .where('enabled', '=', true)
    .orderBy('priority', 'asc')
    .execute()) as RegistryRow[];

  // Live adapters plug in here (R2/R3). Until then, fall back to stub so the
  // pipeline never hard-fails while keys are being configured.
  if (rows.length === 0) return [new StubProvider(capability)];
  return [new StubProvider(capability)];
}

export async function listRegistry(): Promise<RegistryRow[]> {
  return (await db
    .selectFrom('provider_registry')
    .select(['id', 'name', 'capability', 'transport', 'priority', 'enabled'])
    .orderBy('capability')
    .orderBy('priority', 'asc')
    .execute()) as RegistryRow[];
}
