import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { db } from '../db';
import { config } from '../config';
import { createJob, findJobByIdempotency } from '../services/jobs';
import { planOf, requireFeature } from '../middleware/entitlement';
import { expensiveLimiter } from '../middleware/rateLimit';
import { reserveQuota, releaseQuota, reconcileUsage, type QuotaUsage } from '../services/quota';
import { resolveProviders, asVoiceLab, isNotConfiguredError, type Capability } from '../services/providers';
import { logCost } from '../services/cost';
import { jobArtifactDir } from '../services/media';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reserve quota or 429. Returns the usage to store on the job row. */
/** If the request carries an Idempotency-Key for an existing job, return it without touching quota. */
async function checkIdempotent(req: any, reply: any): Promise<{ job_id: string; status: string; deduped: true } | null> {
  const key = idempotencyKey(req);
  if (!key) return null;
  const existing = await findJobByIdempotency(req.user.id, key);
  if (!existing) return null;
  return { job_id: existing.id, status: existing.status as string, deduped: true };
}

async function takeQuota(req: any, reply: any, usage: QuotaUsage): Promise<QuotaUsage | null> {
  const plan = await planOf(req);
  const res = await reserveQuota(req.user.id, plan, usage);
  if (!res.ok) {
    reply.code(429).send({ error: 'quota_exhausted', field: res.field, limit: res.limit, used: res.used });
    return null;
  }
  return usage;
}

function idempotencyKey(req: any): string | undefined {
  const h = req.headers['idempotency-key'];
  return typeof h === 'string' && h.length > 0 ? h : undefined;
}

export default async function toolRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // ---- TTS: synchronous (fast path) ----
  app.post('/tts/generate', {
    preHandler: expensiveLimiter,
    schema: { body: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 20000 }, voice_id: { type: 'string' }, provider: { type: 'string' } } } },
  }, async (req, reply) => {
    const { text, voice_id } = req.body as { text: string; voice_id?: string };
    const usage = await takeQuota(req, reply, { tts_chars: text.length });
    if (!usage) return;

    try {
      const providers = await resolveProviders('tts', 'text-to-speech');
      const jobId = `sync-${crypto.randomUUID()}`;
      const call = { capability: 'tts' as Capability, tool: 'text-to-speech', params: { text, voice_id }, userId: req.user.id, jobId };
      let lastError = 'no provider available';
      for (const provider of providers) {
        try {
          const handle = await provider.submit(call);
          const deadline = Date.now() + 90_000;
          for (;;) {
            const res = await provider.poll(handle, call);
            if (res.status === 'completed') {
              const { urlPrefix } = await jobArtifactDir(req.user.id, jobId);
              const rows = [];
              for (const a of res.artifacts) {
                const row = await db.insertInto('artifacts').values({
                  job_id: null, user_id: req.user.id, kind: a.kind,
                  url: `${urlPrefix}/${a.fileName}`, prompt: text.slice(0, 500), meta: { ...(a.meta ?? {}), provider: provider.name, voice_id: voice_id ?? null },
                }).returningAll().executeTakeFirstOrThrow();
                rows.push({ id: row.id, kind: row.kind, url: row.url, meta: row.meta });
              }
              await logCost({ userId: req.user.id, jobId: null, provider: provider.name, capability: 'tts', tool: 'text-to-speech', units: text.length, costEstimate: res.costEstimate ?? null });
              await reconcileUsage(req.user.id, usage as Record<string, number>);
              return { artifacts: rows, provider: provider.name };
            }
            if (res.status === 'failed') throw new Error(res.error);
            if (Date.now() > deadline) throw new Error('tts timeout');
            await sleep(1000);
          }
        } catch (err: any) {
          if (!isNotConfiguredError(err)) throw err;
          lastError = err?.message ?? String(err);
        }
      }
      throw new Error(lastError);
    } catch (err: any) {
      await releaseQuota(req.user.id, usage);
      return reply.code(502).send({ error: 'tts_failed', message: err?.message ?? String(err) });
    }
  });

  // ---- Bulk images: async (one job, N artifacts) ----
  app.post('/bulk-images/generate', {
    schema: { body: { type: 'object', required: ['prompts'], properties: { prompts: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 }, style: { type: 'string' }, aspect: { type: 'string' } } } },
  }, async (req, reply) => {
    const { prompts, style, aspect } = req.body as { prompts: string[]; style?: string; aspect?: string };
    const dup = await checkIdempotent(req, reply);
    if (dup) return reply.code(200).send(dup);
    const usage = await takeQuota(req, reply, { images: prompts.length });
    if (!usage) return;
    const plan = await planOf(req);
    const { job, deduped } = await createJob({
      userId: req.user.id, tool: 'bulk-images', kind: 'bulk-images', capability: 'image',
      params: { prompts, style, aspect }, quotaReserved: usage,
      idempotencyKey: idempotencyKey(req), priority: plan.features.priority_queue ? 10 : 0,
    });
    return reply.code(deduped ? 200 : 202).send({ job_id: job.id, status: job.status, deduped });
  });

  // ---- Video pipelines: always async ----
  const videoTools: Array<{ path: string; tool: string; kind: string; needsBulk: boolean }> = [
    { path: '/bulk-videos/start', tool: 'bulk-videos', kind: 'bulk-videos', needsBulk: true },
    { path: '/first-last-video/start', tool: 'first-last-video', kind: 'first-last-video', needsBulk: false },
    { path: '/video-studio/start', tool: 'video-studio', kind: 'long-video', needsBulk: false },
    { path: '/lip-sync/start', tool: 'lip-sync', kind: 'lip-sync', needsBulk: false },
    { path: '/ugc-ads/start', tool: 'ugc-ads', kind: 'ugc-ad', needsBulk: false },
    { path: '/bulk-images-to-video/start', tool: 'bulk-images-to-video', kind: 'images-to-video', needsBulk: false },
  ];

  for (const vt of videoTools) {
    app.post(vt.path, {
      preHandler: vt.needsBulk ? requireFeature('bulk_tools') : undefined,
      schema: { body: { type: 'object', properties: { project_name: { type: 'string' }, prompts: { type: 'array', items: { type: 'string' } }, model: { type: 'string' }, style: { type: 'string' }, aspect_ratio: { type: 'string' } } } },
    }, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const prompts = Array.isArray(body.prompts) ? (body.prompts as string[]) : [];
      const scenes = Math.max(1, prompts.length || 1);
      const dup = await checkIdempotent(req, reply);
      if (dup) return reply.code(200).send(dup);
      const usage = await takeQuota(req, reply, { scenes });
      if (!usage) return;

      let projectId: string | null = null;
      if (body.project_name) {
        const p = await db.insertInto('projects').values({ user_id: req.user.id, type: vt.tool, name: String(body.project_name), config: body }).returning('id').executeTakeFirstOrThrow();
        projectId = p.id;
      }
      const plan = await planOf(req);
      const { job, deduped } = await createJob({
        userId: req.user.id, projectId, tool: vt.tool, kind: vt.kind, capability: 'video',
        params: body, quotaReserved: usage,
        idempotencyKey: idempotencyKey(req), priority: plan.features.priority_queue ? 10 : 0,
      });
      return reply.code(deduped ? 200 : 202).send({ job_id: job.id, status: job.status, deduped });
    });
  }

  // ---- R2: Sound effects (synchronous, voice-lab providers) ----
  app.post('/sfx/generate', {
    preHandler: expensiveLimiter,
    schema: { body: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string', minLength: 1, maxLength: 500 }, duration_seconds: { type: 'number', minimum: 0.5, maximum: 30 } } } },
  }, async (req, reply) => {
    const { prompt, duration_seconds } = req.body as { prompt: string; duration_seconds?: number };
    const seconds = Math.min(30, Math.max(0.5, duration_seconds ?? 5));
    // Quota: audio seconds counted against the TTS char budget at the same 14 chars/sec ratio the stub uses.
    const usage = await takeQuota(req, reply, { tts_chars: Math.round(seconds * 14) });
    if (!usage) return;

    try {
      const providers = await resolveProviders('tts', 'sfx');
      const jobId = `sync-${crypto.randomUUID()}`;
      const { dir, urlPrefix } = await jobArtifactDir(req.user.id, jobId);
      let lastError = 'no voice-lab provider available';
      for (const p of providers) {
        const vl = asVoiceLab(p);
        if (!vl) continue;
        try {
          const ext = p.name === 'elevenlabs' ? 'mp3' : 'wav';
          const fileName = `sfx.${ext}`;
          const { costEstimate } = await vl.generateSfx(prompt, seconds, `${dir}/${fileName}`);
          const row = await db.insertInto('artifacts').values({
            job_id: null, user_id: req.user.id, kind: 'audio',
            url: `${urlPrefix}/${fileName}`, prompt: prompt.slice(0, 500),
            meta: { provider: p.name, tool: 'sfx', seconds },
          }).returningAll().executeTakeFirstOrThrow();
          await logCost({ userId: req.user.id, jobId: null, provider: p.name, capability: 'tts', tool: 'sfx', units: seconds, costEstimate });
          await reconcileUsage(req.user.id, usage as Record<string, number>);
          return { artifacts: [{ id: row.id, kind: row.kind, url: row.url, meta: row.meta }], provider: p.name };
        } catch (err: any) {
          if (!isNotConfiguredError(err)) throw err;
          lastError = err?.message ?? String(err);
        }
      }
      throw new Error(lastError);
    } catch (err: any) {
      await releaseQuota(req.user.id, usage);
      return reply.code(502).send({ error: 'sfx_failed', message: err?.message ?? String(err) });
    }
  });

  // ---- R2: Multi-character TTS (async: one job, N segments, one concatenated file) ----
  app.post('/multi-character-tts/start', {
    preHandler: expensiveLimiter,
    schema: {
      body: {
        type: 'object', required: ['segments'],
        properties: {
          project_name: { type: 'string' },
          segments: {
            type: 'array', minItems: 1, maxItems: 20,
            items: { type: 'object', required: ['text'], properties: { voice_id: { type: 'string' }, text: { type: 'string', minLength: 1, maxLength: 5000 } } },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { segments, project_name } = req.body as { segments: Array<{ voice_id?: string; text: string }>; project_name?: string };
    const dup = await checkIdempotent(req, reply);
    if (dup) return reply.code(200).send(dup);
    const chars = segments.reduce((s, x) => s + x.text.length, 0);
    const usage = await takeQuota(req, reply, { tts_chars: chars });
    if (!usage) return;

    let projectId: string | null = null;
    if (project_name) {
      const p = await db.insertInto('projects').values({ user_id: req.user.id, type: 'multi-character-tts', name: String(project_name), config: { segments } }).returning('id').executeTakeFirstOrThrow();
      projectId = p.id;
    }
    const plan = await planOf(req);
    const { job, deduped } = await createJob({
      userId: req.user.id, projectId, tool: 'multi-character-tts', kind: 'multi-character-tts', capability: 'tts',
      params: { segments }, quotaReserved: usage,
      idempotencyKey: idempotencyKey(req), priority: plan.features.priority_queue ? 10 : 0,
    });
    return reply.code(deduped ? 200 : 202).send({ job_id: job.id, status: job.status, deduped });
  });

  // ---- R2: Voice design (async) ----
  app.post('/voice-design/start', {
    preHandler: expensiveLimiter,
    schema: {
      body: {
        type: 'object', required: ['name', 'description'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string', minLength: 1, maxLength: 1000 },
          text: { type: 'string', minLength: 1, maxLength: 5000 },
        },
      },
    },
  }, async (req, reply) => {
    const { name, description, text } = req.body as { name: string; description: string; text?: string };
    const previewText = text ?? 'Hello! This is a preview of the voice you are designing.';
    const dup = await checkIdempotent(req, reply);
    if (dup) return reply.code(200).send(dup);
    const usage = await takeQuota(req, reply, { tts_chars: previewText.length });
    if (!usage) return;
    const plan = await planOf(req);
    const { job, deduped } = await createJob({
      userId: req.user.id, tool: 'voice-design', kind: 'voice-design', capability: 'tts',
      params: { name, description, text: previewText }, quotaReserved: usage,
      idempotencyKey: idempotencyKey(req), priority: plan.features.priority_queue ? 10 : 0,
    });
    return reply.code(deduped ? 200 : 202).send({ job_id: job.id, status: job.status, deduped });
  });

  // ---- R2: Voice clone (multipart upload, async) ----
  app.post('/voice-clone/start', { preHandler: expensiveLimiter }, async (req, reply) => {
    const dup = await checkIdempotent(req, reply);
    if (dup) return reply.code(200).send(dup);

    const uploadId = crypto.randomUUID();
    const uploadDir = path.join(config.artifactDir, 'uploads', req.user.id, uploadId);
    await fs.mkdir(uploadDir, { recursive: true });
    let name = '';
    let description = '';
    let labels: Record<string, string> = {};
    let fileCount = 0;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (++fileCount > 25) throw new Error('too_many_files');
          const safe = path.basename(part.filename || `sample-${fileCount}.mp3`).replace(/[^a-zA-Z0-9._-]/g, '_');
          await fs.writeFile(path.join(uploadDir, safe), await part.toBuffer());
        } else {
          const value = String(part.value ?? '');
          if (part.fieldname === 'name') name = value.slice(0, 100);
          else if (part.fieldname === 'description') description = value.slice(0, 1000);
          else if (part.fieldname === 'labels') {
            try { labels = JSON.parse(value); } catch { /* ignore */ }
          }
        }
      }
    } catch (err: any) {
      await fs.rm(uploadDir, { recursive: true, force: true });
      return reply.code(400).send({ error: 'upload_failed', message: err?.message ?? String(err) });
    }
    if (!name || fileCount === 0) {
      await fs.rm(uploadDir, { recursive: true, force: true });
      return reply.code(400).send({ error: 'validation', message: 'name and at least one audio sample are required' });
    }

    const plan = await planOf(req);
    const { job, deduped } = await createJob({
      userId: req.user.id, tool: 'voice-clone', kind: 'voice-clone', capability: 'tts',
      params: { name, description, labels, upload_dir: uploadDir, file_count: fileCount },
      quotaReserved: {}, idempotencyKey: idempotencyKey(req), priority: plan.features.priority_queue ? 10 : 0,
    });
    if (deduped) await fs.rm(uploadDir, { recursive: true, force: true });
    return reply.code(deduped ? 200 : 202).send({ job_id: job.id, status: job.status, deduped });
  });

}
