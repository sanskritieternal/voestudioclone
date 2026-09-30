import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { db } from '../db';
import { providerKey } from './credentials';
import { resolveProviders, isNotConfiguredError, type Capability } from './providers';
import { jobArtifactDir } from './media';
import { logCost } from './cost';

/**
 * R4 — YouTube automation service.
 *
 * Data tools (channel analyzer, video breakdown, niche finder) use the
 * YouTube Data API v3. Generation tools (SEO metadata, tags, master prompt)
 * use the provider registry's `llm` capability (Gemini when configured).
 *
 * Results are cached in `youtube_analyses` for 24h so repeat lookups are
 * instant and don't burn API quota. Quota accounting happens in the routes.
 */

const YT = 'https://www.googleapis.com/youtube/v3';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function ytNotConfigured(): Error {
  return Object.assign(new Error('youtube_not_configured'), { code: 'youtube_not_configured' });
}

async function ytKey(): Promise<string> {
  const k = await providerKey('youtube');
  if (!k) throw ytNotConfigured();
  return k;
}

async function ytFetch(path: string, params: Record<string, string>): Promise<any> {
  const key = await ytKey();
  const qs = new URLSearchParams({ ...params, key });
  // Bound the wait: a hung upstream must not hang the request forever.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  let res: Response;
  try {
    res = await fetch(`${YT}${path}?${qs.toString()}`, { signal: ctrl.signal });
  } catch (e: any) {
    clearTimeout(timer);
    throw new Error(`youtube_api_failed: ${e?.name === 'AbortError' ? 'request timed out' : (e?.message || e)}`);
  }
  clearTimeout(timer);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`youtube_api_failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ---------- URL parsing ----------

export function parseVideoId(input: string): string | null {
  const s = input.trim();
  const m =
    /(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(s);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  return null;
}

export function parseChannelRef(input: string): { kind: 'id' | 'handle' | 'custom' | 'user'; value: string } | null {
  const s = input.trim();
  let m = /youtube\.com\/channel\/([A-Za-z0-9_-]+)/.exec(s);
  if (m) return { kind: 'id', value: m[1] };
  m = /youtube\.com\/@([A-Za-z0-9_.-]+)/.exec(s);
  if (m) return { kind: 'handle', value: m[1] };
  m = /youtube\.com\/(?:c|user)\/([A-Za-z0-9_-]+)/.exec(s);
  if (m) return { kind: m[0].includes('/user/') ? 'user' : 'custom', value: m[1] };
  if (/^UC[A-Za-z0-9_-]{22}$/.test(s)) return { kind: 'id', value: s };
  if (/^@[A-Za-z0-9_.-]+$/.test(s)) return { kind: 'handle', value: s.slice(1) };
  return null;
}

async function resolveChannelId(ref: { kind: string; value: string }): Promise<string> {
  if (ref.kind === 'id') return ref.value;
  if (ref.kind === 'handle') {
    const j = await ytFetch('/channels', { part: 'id', forHandle: ref.value });
    const id = j.items?.[0]?.id;
    if (!id) throw new Error(`youtube_channel_not_found: @${ref.value}`);
    return id;
  }
  // legacy /c/ and /user/ URLs: fall back to search
  const j = await ytFetch('/search', { part: 'snippet', type: 'channel', q: ref.value, maxResults: '1' });
  const id = j.items?.[0]?.snippet?.channelId;
  if (!id) throw new Error(`youtube_channel_not_found: ${ref.value}`);
  return id;
}

const num = (v: any): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ---------- Data tools ----------

export interface ChannelAnalysis {
  channel: { id: string; title: string; handle: string; description: string; thumbnail: string; country: string; published_at: string };
  stats: { subscribers: number; total_views: number; video_count: number; avg_views_per_video: number };
  recent: { videos_last_30d: number; avg_views_recent: number; top_videos: Array<{ id: string; title: string; views: number; likes: number; published_at: string }> };
}

export async function analyzeChannel(input: string): Promise<ChannelAnalysis> {
  const ref = parseChannelRef(input);
  if (!ref) throw new Error('invalid_channel_url');
  const channelId = await resolveChannelId(ref);

  const ch = await ytFetch('/channels', {
    part: 'snippet,statistics,contentDetails',
    id: channelId,
  });
  const c = ch.items?.[0];
  if (!c) throw new Error('youtube_channel_not_found');
  const uploads = c.contentDetails?.relatedPlaylists?.uploads;

  const pl = uploads
    ? await ytFetch('/playlistItems', { part: 'snippet,contentDetails', playlistId: uploads, maxResults: '25' })
    : { items: [] };
  const videoIds: string[] = (pl.items ?? []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);

  let top: ChannelAnalysis['recent']['top_videos'] = [];
  let recent30 = 0;
  if (videoIds.length) {
    const vids = await ytFetch('/videos', { part: 'snippet,statistics', id: videoIds.join(',') });
    const now = Date.now();
    const items = (vids.items ?? []).map((v: any) => ({
      id: v.id,
      title: v.snippet?.title ?? '',
      views: num(v.statistics?.viewCount),
      likes: num(v.statistics?.likeCount),
      published_at: v.snippet?.publishedAt ?? '',
    }));
    items.sort((a: any, b: any) => b.views - a.views);
    top = items.slice(0, 10);
    recent30 = items.filter((v: any) => now - Date.parse(v.published_at) < 30 * 24 * 3600 * 1000).length;
  }

  const totalViews = num(c.statistics?.viewCount);
  const videoCount = num(c.statistics?.videoCount);
  const avgRecent = top.length ? Math.round(top.reduce((s, v) => s + v.views, 0) / top.length) : 0;

  return {
    channel: {
      id: channelId,
      title: c.snippet?.title ?? '',
      handle: c.snippet?.customUrl ?? '',
      description: (c.snippet?.description ?? '').slice(0, 500),
      thumbnail: c.snippet?.thumbnails?.medium?.url ?? c.snippet?.thumbnails?.default?.url ?? '',
      country: c.snippet?.country ?? '',
      published_at: c.snippet?.publishedAt ?? '',
    },
    stats: {
      subscribers: num(c.statistics?.subscriberCount),
      total_views: totalViews,
      video_count: videoCount,
      avg_views_per_video: videoCount ? Math.round(totalViews / videoCount) : 0,
    },
    recent: { videos_last_30d: recent30, avg_views_recent: avgRecent, top_videos: top },
  };
}

export interface VideoBreakdown {
  video: {
    id: string; title: string; description: string; channel_id: string; channel_title: string;
    published_at: string; duration: string; tags: string[]; category_id: string;
    views: number; likes: number; comments: number;
  };
}

export async function breakdownVideo(input: string): Promise<VideoBreakdown> {
  const videoId = parseVideoId(input);
  if (!videoId) throw new Error('invalid_video_url');
  const j = await ytFetch('/videos', { part: 'snippet,statistics,contentDetails', id: videoId });
  const v = j.items?.[0];
  if (!v) throw new Error('youtube_video_not_found');
  return {
    video: {
      id: videoId,
      title: v.snippet?.title ?? '',
      description: (v.snippet?.description ?? '').slice(0, 2000),
      channel_id: v.snippet?.channelId ?? '',
      channel_title: v.snippet?.channelTitle ?? '',
      published_at: v.snippet?.publishedAt ?? '',
      duration: v.contentDetails?.duration ?? '',
      tags: (v.snippet?.tags ?? []).slice(0, 30),
      category_id: v.snippet?.categoryId ?? '',
      views: num(v.statistics?.viewCount),
      likes: num(v.statistics?.likeCount),
      comments: num(v.statistics?.commentCount),
    },
  };
}

export interface NicheResult {
  keyword: string;
  summary: { videos_analyzed: number; avg_views: number; median_views: number; channels: number; competition: 'low' | 'medium' | 'high'; opportunity_score: number };
  top_videos: Array<{ id: string; title: string; channel: string; views: number; likes: number; published_at: string }>;
}

export async function findNiche(keyword: string, maxResults = 25): Promise<NicheResult> {
  const kw = keyword.trim();
  if (!kw) throw new Error('empty_keyword');
  const n = Math.min(50, Math.max(5, maxResults));
  const s = await ytFetch('/search', {
    part: 'snippet', type: 'video', q: kw, maxResults: String(n), order: 'viewCount', videoDuration: 'any',
  });
  const ids: string[] = (s.items ?? []).map((i: any) => i.id?.videoId).filter(Boolean);
  if (!ids.length) {
    return { keyword: kw, summary: { videos_analyzed: 0, avg_views: 0, median_views: 0, channels: 0, competition: 'low', opportunity_score: 0 }, top_videos: [] };
  }
  const vids = await ytFetch('/videos', { part: 'snippet,statistics', id: ids.join(',') });
  const videos = (vids.items ?? []).map((v: any) => ({
    id: v.id,
    title: v.snippet?.title ?? '',
    channel: v.snippet?.channelTitle ?? '',
    views: num(v.statistics?.viewCount),
    likes: num(v.statistics?.likeCount),
    published_at: v.snippet?.publishedAt ?? '',
  }));
  videos.sort((a: any, b: any) => b.views - a.views);
  const views = videos.map((v: any) => v.views).sort((a: number, b: number) => a - b);
  const avg = views.length ? Math.round(views.reduce((a2: number, b2: number) => a2 + b2, 0) / views.length) : 0;
  const median = views.length ? views[Math.floor(views.length / 2)] : 0;
  const channels = new Set(videos.map((v: any) => v.channel)).size;
  // Heuristic: low avg views + few dominant channels => easier to break into.
  const competition: 'low' | 'medium' | 'high' = avg < 50_000 ? 'low' : avg < 500_000 ? 'medium' : 'high';
  const opportunity = Math.max(0, Math.min(100, Math.round(100 - Math.log10(Math.max(1, avg)) * 12 + (channels >= 10 ? 10 : 0))));

  return {
    keyword: kw,
    summary: { videos_analyzed: videos.length, avg_views: avg, median_views: median, channels, competition, opportunity_score: opportunity },
    top_videos: videos.slice(0, 15),
  };
}

// ---------- LLM tools (via provider registry; no fake content when unconfigured) ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Synchronous text generation through the llm capability chain. Skips the stub. */
export async function generateText(tool: string, prompt: string, userId: string): Promise<{ text: string; provider: string; cost: number }> {
  const providers = await resolveProviders('llm' as Capability, tool);
  let lastError = 'no provider available';
  for (const provider of providers) {
    if (provider.name === 'stub') continue; // never fabricate SEO/tags content
    const call = {
      capability: 'llm' as Capability,
      tool,
      params: { prompt },
      userId,
      jobId: `sync-${crypto.randomUUID()}`,
    };
    try {
      const handle = await provider.submit(call);
      const deadline = Date.now() + 120_000;
      let poll = await provider.poll(handle, call);
      while (poll.status === 'processing' && Date.now() < deadline) {
        await sleep(1500);
        poll = await provider.poll(handle, call);
      }
      if (poll.status !== 'completed') throw new Error(`${provider.name}_llm_failed: ${poll.status}`);
      const file = poll.artifacts[0]?.fileName;
      if (!file) throw new Error(`${provider.name}_llm_failed: no artifact`);
      const { dir } = await jobArtifactDir(userId, call.jobId);
      const text = (await fs.readFile(`${dir}/${file}`, 'utf8')).trim();
      const cost = poll.costEstimate ?? 0;
      if (cost > 0) {
        await logCost({ userId, jobId: null, provider: provider.name, capability: 'llm', tool, units: 1, costEstimate: cost });
      }
      return { text, provider: provider.name, cost };
    } catch (err: any) {
      if (isNotConfiguredError(err)) { lastError = err.message; continue; }
      throw err; // real failure: fail loudly, no fallback to fabrication
    }
  }
  throw Object.assign(new Error('llm_not_configured: add a Gemini API key on the API Keys page'), { code: 'llm_not_configured', detail: lastError });
}

const SEO_PROMPT = (title: string, category: string) => `You are a YouTube SEO expert. Generate optimized metadata for a YouTube video.

Video topic/title: ${title}
${category ? `Category: ${category}\n` : ''}Respond in this exact format:

TITLE:
<one optimized title, max 70 characters, with a hook>

DESCRIPTION:
<2-3 paragraph description with keywords naturally woven in, plus a call to action. Max 300 words.>

TAGS:
<15 comma-separated tags, most specific first>

HASHTAGS:
<3-5 hashtags for the description, e.g. #topic>`;

const TAGS_PROMPT = (topic: string, platform: string) => `You are a YouTube discoverability expert. Generate tags for this video topic.

Topic: ${topic}
Platform: ${platform || 'YouTube'}

Respond in this exact format:

TAGS:
<20 comma-separated tags ordered from most specific/long-tail to broad>

LONG_TAIL:
<5 long-tail keyword phrases viewers actually search for, one per line>

HASHTAGS:
<5 hashtags>`;

export async function generateSeo(title: string, category: string, userId: string): Promise<{ markdown: string; provider: string }> {
  const t = title.trim();
  if (!t) throw new Error('empty_title');
  const { text, provider } = await generateText('youtube-seo', SEO_PROMPT(t, category.trim()), userId);
  return { markdown: text, provider };
}

export async function generateTags(topic: string, platform: string, userId: string): Promise<{ markdown: string; provider: string }> {
  const t = topic.trim();
  if (!t) throw new Error('empty_topic');
  const { text, provider } = await generateText('youtube-tags', TAGS_PROMPT(t, platform.trim()), userId);
  return { markdown: text, provider };
}

export async function generateMasterPrompt(videoUrl: string, notes: string, userId: string): Promise<{ markdown: string; provider: string; source_video: VideoBreakdown['video'] | null }> {
  let source: VideoBreakdown['video'] | null = null;
  let context = '';
  const vid = videoUrl.trim() ? parseVideoId(videoUrl.trim()) : null;
  if (vid) {
    try {
      const bd = await breakdownVideo(vid);
      source = bd.video;
      context = `\nReference video:\n- Title: ${source.title}\n- Channel: ${source.channel_title}\n- Views: ${source.views}, Likes: ${source.likes}\n- Description (excerpt): ${source.description.slice(0, 600)}\n- Tags: ${source.tags.slice(0, 12).join(', ')}`;
    } catch {
      context = '\n(The reference video URL could not be fetched; build the prompt from the notes alone.)';
    }
  }
  const prompt = `You are a viral YouTube content strategist. Write a "master prompt" — a complete, reusable production brief — for recreating the style and structure of a successful video for a new topic.
${context}
${notes.trim() ? `\nCreator notes / focus areas:\n${notes.trim()}\n` : ''}
Respond in this exact format:

MASTER PROMPT:
<A detailed, copy-paste-ready prompt (300-500 words) covering: hook (first 15 seconds), structure/acts, pacing, visual style, narration tone, B-roll/music cues, retention tactics, and CTA.>

TITLE IDEAS:
<5 title ideas>

THUMBNAIL IDEAS:
<3 thumbnail concepts described visually>`;
  const { text, provider } = await generateText('youtube-master-prompt', prompt, userId);
  return { markdown: text, provider, source_video: source };
}

// ---------- Cache ----------

/** Canonical JSON: sorted keys so equal inputs produce equal strings. */
function norm(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) o[k] = norm((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}

const normStr = (v: unknown): string => JSON.stringify(norm(v));

export async function getCached(userId: string, kind: string, input: Record<string, unknown>): Promise<{ result: Record<string, unknown>; cached: true } | null> {
  const want = normStr(input);
  // Compare in JS: jsonb key order is not stable for SQL-side string compare.
  const rows = await db
    .selectFrom('youtube_analyses')
    .select(['input', 'result', 'created_at'])
    .where('user_id', '=', userId)
    .where('kind', '=', kind)
    .orderBy('created_at', 'desc')
    .limit(50)
    .execute();
  for (const row of rows) {
    if (normStr(row.input) !== want) continue;
    if (Date.now() - new Date(row.created_at).getTime() > CACHE_TTL_MS) return null;
    return { result: row.result as Record<string, unknown>, cached: true };
  }
  return null;
}

export async function saveAnalysis(userId: string, kind: string, input: Record<string, unknown>, result: Record<string, unknown>): Promise<void> {
  await db
    .insertInto('youtube_analyses')
    .values({ user_id: userId, kind, input: norm(input) as any, result: result as any })
    .execute();
}

export async function listHistory(userId: string, limit = 50): Promise<Array<{ id: string; kind: string; input: Record<string, unknown>; created_at: Date }>> {
  const rows = await db
    .selectFrom('youtube_analyses')
    .select(['id', 'kind', 'input', 'created_at'])
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map((r) => ({ id: r.id, kind: r.kind, input: r.input as Record<string, unknown>, created_at: r.created_at }));
}

export async function deleteHistory(userId: string, id: string): Promise<boolean> {
  const res = await db
    .deleteFrom('youtube_analyses')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return Number(res.numDeletedRows ?? 0) > 0;
}
