import crypto from 'node:crypto';
import { db } from '../db';
import { config } from '../config';
import { jobArtifactDir, writeSlateSvg, writeSilentWav, writeToneWav, wrapPcmAsWav } from './media';
import { ElevenLabsTtsProvider } from './providers/elevenlabs';

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

/**
 * Optional voice-lab surface (R2). Implemented by providers that support
 * segment synthesis (multi-character TTS), sound effects, voice design
 * and voice cloning. The worker's voice tools use the first chain
 * provider that implements it.
 */
export interface VoiceLab {
  synthSegment(text: string, voiceId: string | undefined, outPath: string): Promise<{ chars: number; costEstimate: number }>;
  generateSfx(prompt: string, seconds: number, outPath: string): Promise<{ costEstimate: number }>;
  designVoice(p: { name: string; description: string; text: string }, outPath: string): Promise<{ designId: string | null; costEstimate: number }>;
  cloneVoice(p: {
    name: string;
    description?: string;
    labels?: Record<string, string>;
    files: Array<{ filename: string; data: Buffer; contentType: string }>;
  }): Promise<{ voiceId: string }>;
}

export function asVoiceLab(p: CapabilityProvider): VoiceLab | null {
  return 'synthSegment' in p ? (p as unknown as VoiceLab) : null;
}

/**
 * Fallback semantics (R2): a provider that is not configured (no API key)
 * yields to the next provider in the chain — this is the "keys are still
 * being configured" state. Any other error (bad key, 4xx/5xx, timeout) is
 * fatal for the chain: the job fails loudly instead of silently producing
 * stub artifacts that look like real output.
 */
export function isNotConfiguredError(err: any): boolean {
  return !!err?.code && String(err.code).endsWith('_not_configured');
}

/** Local fake: completes after a few seconds, writes viewable stub artifacts. */
export class StubProvider implements CapabilityProvider, VoiceLab {
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
      const prefix = String(call.params.artifact_prefix ?? 'tts');
      const seconds = Math.min(120, Math.max(2, Math.round(text.length / 14)));
      await writeSilentWav(`${dir}/${prefix}.wav`, seconds);
      artifacts.push({ kind: 'audio', fileName: `${prefix}.wav`, meta: { stub: true, seconds, chars: text.length } });
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

  // ---- VoiceLab (stub): audible tone files so the pipeline stays testable ----
  async synthSegment(text: string, _voiceId: string | undefined, outPath: string): Promise<{ chars: number; costEstimate: number }> {
    const seconds = Math.min(60, Math.max(1, Math.round(text.length / 14)));
    await writeSilentWav(outPath, seconds);
    return { chars: text.length, costEstimate: 0 };
  }

  async generateSfx(prompt: string, seconds: number, outPath: string): Promise<{ costEstimate: number }> {
    await writeToneWav(outPath, Math.min(30, Math.max(1, seconds)), 440 + (prompt.length % 400));
    return { costEstimate: 0 };
  }

  async designVoice(p: { name: string; description: string; text: string }, outPath: string): Promise<{ designId: string | null; costEstimate: number }> {
    await writeToneWav(outPath, 6, 330);
    return { designId: `stub-design-${crypto.randomUUID().slice(0, 8)}`, costEstimate: 0 };
  }

  async cloneVoice(p: { name: string; description?: string; files: Array<{ filename: string; data: Buffer; contentType: string }> }): Promise<{ voiceId: string }> {
    void p;
    return { voiceId: `stub-${crypto.randomUUID().slice(0, 12)}` };
  }
}

export interface RegistryRow {
  id: string;
  name: string;
  capability: string;
  transport: string;
  priority: number;
  enabled: boolean;
  default_model: string | null;
  config: Record<string, unknown>;
}

/**
 * Resolve the provider chain for a capability. In stub mode (R1) this
 * always yields a StubProvider; in live mode it instantiates adapters
 * for enabled registry rows ordered by priority, skipping rows whose
 * adapter has not landed yet (their adapters are noted in the logs).
 * When nothing live can be instantiated, the stub is kept as the final
 * fallback so the pipeline never hard-fails while keys are configured.
 */
export async function resolveProviders(capability: Capability, _tool: string): Promise<CapabilityProvider[]> {
  if (config.providerMode === 'stub') return [new StubProvider(capability)];

  const rows = (await db
    .selectFrom('provider_registry')
    .select(['id', 'name', 'capability', 'transport', 'priority', 'enabled', 'default_model', 'config'])
    .where('capability', '=', capability)
    .where('enabled', '=', true)
    .orderBy('priority', 'asc')
    .execute()) as RegistryRow[];

  const chain: CapabilityProvider[] = [];
  for (const row of rows) {
    if (row.name === 'elevenlabs' && capability === 'tts') {
      chain.push(new ElevenLabsTtsProvider(row.default_model ?? 'eleven_multilingual_v2'));
    } else {
      // Adapter not implemented yet (Gemini lands in R3, fal/Replicate/Together/self-hosted later).
      console.warn(`provider row "${row.id}" has no adapter yet; skipping`);
    }
  }
  // The stub stays as the final fallback so unconfigured providers degrade
  // gracefully; see isNotConfiguredError for when the chain yields vs fails.
  chain.push(new StubProvider(capability));
  return chain;
}

export async function listRegistry(): Promise<RegistryRow[]> {
  return (await db
    .selectFrom('provider_registry')
    .select(['id', 'name', 'capability', 'transport', 'priority', 'enabled'])
    .orderBy('capability')
    .orderBy('priority', 'asc')
    .execute()) as RegistryRow[];
}
