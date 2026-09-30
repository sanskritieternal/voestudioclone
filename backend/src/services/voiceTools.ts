import { promises as fs } from 'node:fs';
import path from 'node:path';
import { db } from '../db';
import { concatWavFiles, jobArtifactDir } from './media';
import { asVoiceLab, isNotConfiguredError, type CapabilityProvider, type NewArtifact } from './providers';

/**
 * Voice-lab job runners (R2). Each walks the resolved provider chain and
 * uses the first provider implementing the VoiceLab surface; failures
 * fall through to the next provider (usually the stub).
 */

export interface McSegment {
  voice_id?: string;
  text: string;
}

export async function runMultiCharTts(opts: {
  userId: string;
  jobId: string;
  segments: McSegment[];
  providers: CapabilityProvider[];
  onProgress?: (pct: number) => void;
}): Promise<{ artifacts: NewArtifact[]; costEstimate: number; provider: string; chars: number; seconds: number }> {
  const segs = opts.segments;
  if (!segs.length || segs.length > 20) throw new Error('segments must be 1..20');
  for (const s of segs) {
    if (!s.text || s.text.length > 5000) throw new Error('each segment text must be 1..5000 chars');
  }

  let lastError = 'no voice-lab provider available';
  for (const p of opts.providers) {
    const vl = asVoiceLab(p);
    if (!vl) continue;
    try {
      const { dir } = await jobArtifactDir(opts.userId, opts.jobId);
      const segFiles: string[] = [];
      let chars = 0;
      let cost = 0;
      for (let i = 0; i < segs.length; i++) {
        const f = `${dir}/seg-${i}.wav`;
        const r = await vl.synthSegment(segs[i].text, segs[i].voice_id, f);
        segFiles.push(f);
        chars += r.chars;
        cost += r.costEstimate;
        opts.onProgress?.(Math.round(((i + 1) / (segs.length + 1)) * 100));
      }
      const { seconds } = await concatWavFiles(segFiles, `${dir}/multi-char.wav`);
      await Promise.all(segFiles.map((f) => fs.unlink(f).catch(() => undefined)));
      opts.onProgress?.(100);
      return {
        artifacts: [
          {
            kind: 'audio',
            fileName: 'multi-char.wav',
            prompt: segs.map((s) => s.text).join(' ').slice(0, 500),
            meta: { provider: p.name, segments: segs.length, chars, seconds: Math.round(seconds) },
          },
        ],
        costEstimate: cost,
        provider: p.name,
        chars,
        seconds,
      };
    } catch (err: any) {
      if (!isNotConfiguredError(err)) throw err;
      lastError = err?.message ?? String(err);
    }
  }
  throw new Error(lastError);
}

export async function runVoiceDesign(opts: {
  userId: string;
  jobId: string;
  name: string;
  description: string;
  text: string;
  providers: CapabilityProvider[];
}): Promise<{ artifacts: NewArtifact[]; costEstimate: number; provider: string; designId: string | null }> {
  let lastError = 'no voice-lab provider available';
  for (const p of opts.providers) {
    const vl = asVoiceLab(p);
    if (!vl) continue;
    try {
      const { dir } = await jobArtifactDir(opts.userId, opts.jobId);
      const ext = p.name === 'elevenlabs' ? 'mp3' : 'wav';
      const fileName = `design-preview.${ext}`;
      const r = await vl.designVoice({ name: opts.name, description: opts.description, text: opts.text }, `${dir}/${fileName}`);
      return {
        artifacts: [{ kind: 'audio', fileName, prompt: opts.description.slice(0, 500), meta: { provider: p.name, design_id: r.designId, voice_name: opts.name } }],
        costEstimate: r.costEstimate,
        provider: p.name,
        designId: r.designId,
      };
    } catch (err: any) {
      if (!isNotConfiguredError(err)) throw err;
      lastError = err?.message ?? String(err);
    }
  }
  throw new Error(lastError);
}

export async function runVoiceClone(opts: {
  userId: string;
  name: string;
  description?: string;
  labels?: Record<string, string>;
  uploadDir: string;
  providers: CapabilityProvider[];
}): Promise<{ voiceId: string; provider: string }> {
  const entries = await fs.readdir(opts.uploadDir).catch(() => []);
  const files = await Promise.all(
    entries.map(async (name) => ({
      filename: name,
      data: await fs.readFile(path.join(opts.uploadDir, name)),
      contentType: 'audio/mpeg',
    })),
  );
  if (files.length === 0) throw new Error('no audio samples uploaded');

  let lastError = 'no voice-lab provider available';
  for (const p of opts.providers) {
    const vl = asVoiceLab(p);
    if (!vl) continue;
    try {
      const { voiceId } = await vl.cloneVoice({ name: opts.name, description: opts.description, labels: opts.labels, files });
      // Register in the voices catalog so it shows up in GET /api/voices.
      const stub = p.name !== 'elevenlabs';
      await db
        .insertInto('voices')
        .values({
          provider: stub ? 'stub' : 'elevenlabs',
          provider_voice_id: voiceId,
          name: opts.name,
          gender: opts.labels?.gender ?? null,
          language: opts.labels?.language ?? 'en',
          country: null,
          preview_url: null,
          meta: { stub, cloned: true, labels: opts.labels ?? {}, description: opts.description ?? null },
          synced_at: new Date(),
        })
        .onConflict((oc) => oc.column('provider_voice_id').doNothing())
        .execute();
      return { voiceId, provider: p.name };
    } catch (err: any) {
      if (!isNotConfiguredError(err)) throw err;
      lastError = err?.message ?? String(err);
    }
  }
  throw new Error(lastError);
}

/** Remove the temp upload dir after cloning (success or failure). */
export async function cleanupUploadDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}
