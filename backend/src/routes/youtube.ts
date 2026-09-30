import type { FastifyInstance } from 'fastify';
import { planOf } from '../middleware/entitlement';
import { expensiveLimiter } from '../middleware/rateLimit';
import { reserveQuota, releaseQuota } from '../services/quota';
import {
  analyzeChannel, breakdownVideo, findNiche, generateSeo, generateTags,
  generateMasterPrompt, getCached, saveAnalysis, listHistory, deleteHistory,
} from '../services/youtube';

/**
 * R4 — YouTube automation API.
 *
 * Data tools (channel-analyze, video-breakdown, niche-finder) need a YouTube
 * Data API v3 key (API Keys page -> Provider integrations). Generation tools
 * (seo, tags, master-prompt) need an LLM provider (Gemini). Without the key,
 * the route returns 503 with a clear code instead of fabricated data.
 * Results are cached per user for 24h (youtube_analyses).
 */
export default async function youtubeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  async function takeQuota(req: any, reply: any): Promise<boolean> {
    const plan = await planOf(req);
    const res = await reserveQuota(req.user.id, plan, { niche_analyses: 1 });
    if (!res.ok) {
      reply.code(429).send({ error: 'quota_exhausted', field: res.field, limit: res.limit, used: res.used });
      return false;
    }
    return true;
  }

  // Failures that never reached the upstream (missing key, bad input) release the
  // reserved quota. Real upstream errors (502) and not-found lookups (404) stay charged.
  async function configError(err: any, req: any, reply: any): Promise<boolean> {
    const code = err?.code ?? '';
    const msg = String(err?.message ?? '');
    const neverTouchedUpstream =
      code === 'youtube_not_configured' || code === 'llm_not_configured' ||
      msg.startsWith('invalid_') || msg.startsWith('empty_');
    if (neverTouchedUpstream) await releaseQuota(req.user.id, { niche_analyses: 1 });
    if (code === 'youtube_not_configured') {
      reply.code(503).send({ error: 'youtube_not_configured', message: 'Add a YouTube Data API key under API Keys → Provider integrations.' });
      return true;
    }
    if (code === 'llm_not_configured') {
      reply.code(503).send({ error: 'llm_not_configured', message: 'Add a Gemini API key under API Keys → Provider integrations.' });
      return true;
    }
    if (msg.startsWith('invalid_') || msg.startsWith('empty_')) {
      reply.code(400).send({ error: msg.split(':')[0] });
      return true;
    }
    if (msg.startsWith('youtube_channel_not_found') || msg.startsWith('youtube_video_not_found')) {
      reply.code(404).send({ error: 'not_found', message: 'No channel/video matched that URL.' });
      return true;
    }
    return false;
  }

  // Cache-first: a repeat lookup within 24h (or an invalid request) costs no quota.
  // Returns null when the reply was already sent (quota exhausted).
  async function runCached(req: any, reply: any, kind: string, input: Record<string, unknown>, compute: () => Promise<Record<string, unknown>>) {
    const hit = await getCached(req.user.id, kind, input);
    if (hit) return { ...hit.result, cached: true };
    if (!(await takeQuota(req, reply))) return null;
    const result = await compute();
    await saveAnalysis(req.user.id, kind, input, result);
    return { ...result, cached: false };
  }

  // ---- Channel analyzer ----
  app.post('/channel-analyze', {
    preHandler: expensiveLimiter,
    schema: { body: { type: 'object', required: ['channel_url'], properties: { channel_url: { type: 'string', minLength: 3, maxLength: 500 } } } },
  }, async (req, reply) => {
    const { channel_url } = req.body as { channel_url: string };
    try {
      const _out = await runCached(req, reply, 'channel', { channel_url }, async () => ({ ...(await analyzeChannel(channel_url)) }));
      if (_out) return _out;
    } catch (err: any) {
      if (!(await configError(err, req, reply))) reply.code(502).send({ error: 'youtube_failed', message: String(err.message).slice(0, 300) });
    }
  });

  // ---- Video breakdown ----
  app.post('/video-breakdown', {
    preHandler: expensiveLimiter,
    schema: { body: { type: 'object', required: ['video_url'], properties: { video_url: { type: 'string', minLength: 3, maxLength: 500 } } } },
  }, async (req, reply) => {
    const { video_url } = req.body as { video_url: string };
    try {
      const _out = await runCached(req, reply, 'video', { video_url }, async () => ({ ...(await breakdownVideo(video_url)) }));
      if (_out) return _out;
    } catch (err: any) {
      if (!(await configError(err, req, reply))) reply.code(502).send({ error: 'youtube_failed', message: String(err.message).slice(0, 300) });
    }
  });

  // ---- Niche finder ----
  app.post('/niche-finder', {
    preHandler: expensiveLimiter,
    schema: { body: { type: 'object', required: ['keyword'], properties: { keyword: { type: 'string', minLength: 2, maxLength: 200 }, max_results: { type: 'number' } } } },
  }, async (req, reply) => {
    const { keyword, max_results } = req.body as { keyword: string; max_results?: number };
    try {
      const _out = await runCached(req, reply, 'niche', { keyword: keyword.trim().toLowerCase() }, async () => ({ ...(await findNiche(keyword, max_results)) }));
      if (_out) return _out;
    } catch (err: any) {
      if (!(await configError(err, req, reply))) reply.code(502).send({ error: 'youtube_failed', message: String(err.message).slice(0, 300) });
    }
  });

  // ---- SEO generator (LLM) ----
  app.post('/seo-generate', {
    preHandler: expensiveLimiter,
    schema: { body: { type: 'object', required: ['title'], properties: { title: { type: 'string', minLength: 3, maxLength: 300 }, category: { type: 'string', maxLength: 100 } } } },
  }, async (req, reply) => {
    const { title, category } = req.body as { title: string; category?: string };
    try {
      const _out = await runCached(req, reply, 'seo', { title: title.trim(), category: (category ?? '').trim() }, async () => {
        const r = await generateSeo(title, category ?? '', req.user.id);
        return { markdown: r.markdown, provider: r.provider };
      });
      if (_out) return _out;
    } catch (err: any) {
      if (!(await configError(err, req, reply))) reply.code(502).send({ error: 'llm_failed', message: String(err.message).slice(0, 300) });
    }
  });

  // ---- Tags generator (LLM) ----
  app.post('/tags-generate', {
    preHandler: expensiveLimiter,
    schema: { body: { type: 'object', required: ['topic'], properties: { topic: { type: 'string', minLength: 2, maxLength: 200 }, platform: { type: 'string', maxLength: 50 } } } },
  }, async (req, reply) => {
    const { topic, platform } = req.body as { topic: string; platform?: string };
    try {
      const _out = await runCached(req, reply, 'tags', { topic: topic.trim().toLowerCase(), platform: (platform ?? '').trim() }, async () => {
        const r = await generateTags(topic, platform ?? '', req.user.id);
        return { markdown: r.markdown, provider: r.provider };
      });
      if (_out) return _out;
    } catch (err: any) {
      if (!(await configError(err, req, reply))) reply.code(502).send({ error: 'llm_failed', message: String(err.message).slice(0, 300) });
    }
  });

  // ---- Master prompt (video breakdown + LLM) ----
  app.post('/master-prompt', {
    preHandler: expensiveLimiter,
    schema: { body: { type: 'object', properties: { video_url: { type: 'string', maxLength: 500 }, notes: { type: 'string', maxLength: 2000 } } } },
  }, async (req, reply) => {
    const { video_url, notes } = req.body as { video_url?: string; notes?: string };
    try {
      const _out = await runCached(req, reply, 'master-prompt', { video_url: (video_url ?? '').trim(), notes: (notes ?? '').trim() }, async () => {
        const r = await generateMasterPrompt(video_url ?? '', notes ?? '', req.user.id);
        return { markdown: r.markdown, provider: r.provider, source_video: r.source_video };
      });
      if (_out) return _out;
    } catch (err: any) {
      if (!(await configError(err, req, reply))) reply.code(502).send({ error: 'llm_failed', message: String(err.message).slice(0, 300) });
    }
  });

  // ---- History ----
  app.get('/history', async (req) => {
    const items = await listHistory(req.user.id);
    return { items };
  });

  app.get('/history/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await listHistory(req.user.id, 500);
    const hit = rows.find((r) => r.id === id);
    if (!hit) return reply.code(404).send({ error: 'not_found' });
    const cached = await getCached(req.user.id, hit.kind, hit.input as Record<string, unknown>);
    return { id, kind: hit.kind, input: hit.input, result: cached?.result ?? null, created_at: hit.created_at };
  });

  app.delete('/history/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await deleteHistory(req.user.id, id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
}
