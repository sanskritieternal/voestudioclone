import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../db';
import { createJob, findJobByIdempotency } from '../services/jobs';
import { planOf, requireFeature } from '../middleware/entitlement';
import { reserveQuota, releaseQuota, reconcileUsage, type QuotaUsage } from '../services/quota';
import { resolveProviders, type Capability } from '../services/providers';
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
    schema: { body: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 20000 }, voice_id: { type: 'string' }, provider: { type: 'string' } } } },
  }, async (req, reply) => {
    const { text, voice_id } = req.body as { text: string; voice_id?: string };
    const usage = await takeQuota(req, reply, { tts_chars: text.length });
    if (!usage) return;

    try {
      const [provider] = await resolveProviders('tts', 'text-to-speech');
      const jobId = `sync-${crypto.randomUUID()}`;
      const call = { capability: 'tts' as Capability, tool: 'text-to-speech', params: { text, voice_id }, userId: req.user.id, jobId };
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
          await logCost({ userId: req.user.id, jobId: null, provider: provider.name, capability: 'tts', units: text.length, costEstimate: res.costEstimate ?? null });
          await reconcileUsage(req.user.id, usage as Record<string, number>);
          return { artifacts: rows, provider: provider.name };
        }
        if (res.status === 'failed') throw new Error(res.error);
        if (Date.now() > deadline) throw new Error('tts timeout');
        await sleep(1000);
      }
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

}
