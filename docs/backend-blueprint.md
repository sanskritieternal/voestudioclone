# VEO Studio Ai — Backend Blueprint

**Status:** DRAFT proposal for vaibhav's confirmation — 2026-09-30
**Stack (decided):** Node.js + Fastify + Postgres + Redis/BullMQ
**Topology (default):** modular monolith — one repo, Fastify API + BullMQ worker processes, Docker Compose on VPS

Conventions used in this doc:
- **[OBSERVED]** — captured from the live site during recon (method + path only; no request/response shapes were visible).
- **[PROPOSED]** — design choice being put forward for confirmation.

---

## 1. Architecture

```
                    ┌─────────────┐
                    │    nginx    │  (reverse proxy, TLS, static frontend)
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │   Fastify API server    │  POST /api/auth/login …
              │   (Node.js, 2+ procs)   │  …/api/tools/*/start → enqueue
              └────────────┬────────────┘
                           │ BullMQ
              ┌────────────┴────────────┐
              │  Worker processes       │  video / image / tts / youtube queues
              │  (scaled independently) │
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │ Postgres  │  Redis      │
              │ (data)    │ (queue, quota counters, cache)
              └─────────────────────────┘
```

**[PROPOSED]** decisions:
1. **Modular monolith, one repo** (`backend/`): `src/api` (Fastify routes), `src/workers`, `src/queues`, `src/services` (providers), `src/models` (db), `src/middleware`. Split into services later only if a worker type needs independent scaling.
2. **Fastify serves `/api/*`; nginx serves the static frontend** and proxies `/api/*` to Fastify. Keeps the 45-page static clone deployable as-is.
3. **Postgres** is the system of record. **Redis** holds BullMQ queues, per-day quota counters (fast atomic increments), and cache (voices catalog, YouTube results).
4. **File artifacts** (generated audio/images/video): local disk volume in v1 (`/data/artifacts`), behind an `[PROPOSED]` S3-compatible abstraction so it can move to object storage without code changes.
5. **Job progress**: client polls `GET /api/jobs/:id` (simple, matches the static frontend). SSE/WebSocket is a later upgrade, not v1.

### 1.1 What the observed API tells us

**[OBSERVED]** endpoints (method + path only):

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | credentials → session |
| GET | `/api/auth/me` | current user + plan |
| GET/POST | `/api/projects` | list / create |
| GET | `/api/projects/:id` | single project |
| GET | `/api/voices` | voice catalog (filters seen in UI: language, gender, country, search) |
| GET | `/api/voices/languages` | language facet list |
| POST | `/api/tools/tts/generate` | single TTS |
| POST | `/api/tools/bulk-images/generate` | bulk image generation |
| POST | `/api/tools/bulk-videos/start` | bulk video pipeline |
| POST | `/api/tools/first-last-video/start` | first+last frame video |
| GET | `/api/branding/logo_*.png`, `favicon_*.png` | tenant branding assets |

**[OBSERVED]** behaviors with backend implications:
- Video endpoints use `/start` + UI shows "threads", "scenes/cycle", job lists → **async job pipeline, not request/response**.
- Free plan quotas: 100 TTS chars/day, 10 niche analyses/day, 1 image/day, 1 thread, 2-min max video, 1 scene/cycle, **daily reset** → **server-side quota ledger + reset job**.
- Free users are bounced off gated tools → **plan entitlement checks enforced server-side on every tool route**.
- Plans page buttons read **"Contact to Upgrade"** (not "Pay") → **v1 billing is sales-led/manual activation, no payment gateway**. This is a load-bearing observation — see §6.
- "580+ voices", ElevenLabs tool family → **third-party TTS provider(s) with a cached voice catalog**.

---

## 2. Module map → backend domains

From the 45 cloned routes, the backend owns these domains (public marketing pages need nothing):

| Domain | Routes served | Backend surface |
|---|---|---|
| Identity & access | `/login`, `/my-accounts`, `/profile` | auth, sessions, password reset |
| Billing & plans | `/plans`, `/offers`, `/billing` | plans catalog, subscriptions, manual activation |
| Projects | `/projects`, `/projects/new`, `/projects/templates`, `/projects/prompting-rules`, `/editor`, `/editor/projects` | project CRUD, templates, prompting rules |
| Video generation | `/tools/video-studio`, `/tools/bulk-videos`, `/tools/first-last-video`, `/tools/bulk-images-to-video`, `/tools/lip-sync`, `/tools/ugc-ads`, `/tools/image-to-prompt`, `/tools/video-breakdown`, `/tools/video-master-prompt` | async job pipelines per tool |
| Audio | `/tools/text-to-speech`, `/tools/multi-character-tts`, ElevenLabs TTS/SFX/STS/voice-design/voice-cloning, `/tools/voice-history` | TTS (sync), voice catalog, history |
| YouTube automation | `/tools/youtube-niche-finder`, `/tools/youtube-seo-generator`, `/tools/tags-generator`, `/tools/channel-analyzer`, `/tools/youtube-history` | analysis jobs (fast, cacheable) |
| Jobs | `/my-jobs`, `/dashboard` | job listing, progress, dashboard aggregates |
| Developer API | `/api-keys`, `/api-docs` | key issuance, scoped access |
| Support | `/ai-chat`, `/support`, `/help` | chat threads, tickets/FAQ |
| Growth | `/affiliate`, `/child-panel` | referrals, white-label tenants |

---

## 3. Data model (Postgres)

**[PROPOSED]** — tables, with the fields the UI observably needs:

### 3.1 Identity, plans, billing
- `users(id, email UNIQUE, password_hash, name, avatar_url, plan_id FK, status, email_verified, created_at, last_login_at)`
- `plans(id, slug UNIQUE, name, price_inr, billing_period, limits JSONB, features JSONB, is_active)` — limits drive everything:
  ```json
  { "threads": 1, "max_video_minutes": 2, "scenes_per_cycle": 1,
    "tts_chars_daily": 100, "images_daily": 1, "niche_analyses_daily": 10,
    "bulk_tools": false, "api_access": false, "priority_queue": false }
  ```
- `subscriptions(id, user_id FK, plan_id FK, status, started_at, ends_at, activated_by, notes)` — manual activation recorded here **[PROPOSED]** per the "Contact to Upgrade" observation.
- `api_keys(id, user_id FK, key_hash UNIQUE, name, scopes TEXT[], last_used_at, revoked_at)`

### 3.2 Quota ledger
- `daily_usage(user_id, day DATE, tts_chars INT, images INT, niche_analyses INT, scenes INT, ai_tokens_in INT, ai_tokens_out INT, PRIMARY KEY(user_id, day))`
- **[PROPOSED]** Redis mirrors the current day's counters for atomic check-and-decrement; Postgres is the durable ledger reconciled by workers. Reset = new day row, no cron needed (lazy), plus a nightly job that prunes rows older than 90 days.

### 3.3 Projects & jobs
- `projects(id, user_id FK, type, name, status, config JSONB, created_at, updated_at)` — `config` holds tool-specific params (model, style, aspect, prompts…).
- `jobs(id, user_id FK, project_id FK NULL, tool TEXT, kind TEXT, status, progress SMALLINT, params JSONB, result JSONB, error TEXT, attempts SMALLINT, bullmq_job_id TEXT, idempotency_key TEXT UNIQUE, created_at, updated_at)` — `status`: `queued|active|completed|failed|cancelled`.
- `artifacts(id, job_id FK, user_id FK, kind [audio|image|video], url, prompt TEXT, meta JSONB, created_at)` — voice_history and generation galleries read from here.

### 3.4 Voices & YouTube
- `voices(id, provider, provider_voice_id UNIQUE, name, gender, language, country, preview_url, meta JSONB, synced_at)` — cache of the provider catalog; nightly sync job.
- `youtube_analyses(id, user_id FK, kind [niche|seo|tags|channel], input JSONB, result JSONB, created_at)` — cacheable; identical inputs within 24h return cached rows without spending quota **[PROPOSED]**.

### 3.5 Support, growth, white-label
- `chat_threads(id, user_id FK, title, created_at)`, `chat_messages(id, thread_id FK, role, content, tokens_in, tokens_out, created_at)` — AI-chat token usage feeds the dashboard's token cards **[OBSERVED: dashboard shows Input/Output/Total tokens]**.
- `support_tickets(id, user_id FK, subject, body, status, created_at)` (contact/support forms land here).
- `referrals(id, referrer_id FK, referred_id FK, status, commission_inr, created_at)` — affiliate domain.
- `child_panels(id, owner_id FK, slug UNIQUE, brand_name, logo_url, primary_color, status)` — white-label tenants; `/api/branding/*` serves per-tenant assets **[OBSERVED]**.

---

## 4. API design

Base: `/api`. Auth: `Authorization: Bearer <jwt>` **[PROPOSED]** (cookie alternative noted in §8 open questions).

### 4.1 Auth & me **[OBSERVED paths, PROPOSED shapes]**
- `POST /api/auth/login` `{email, password}` → `200 {token, refresh_token, user}` / `401`
- `POST /api/auth/refresh` `{refresh_token}` → `200 {token}` **[PROPOSED]**
- `POST /api/auth/logout` → revokes refresh token **[PROPOSED]**
- `GET /api/auth/me` → `200 {user, plan: {slug, name, limits}, quotas: {tts_chars_used, tts_chars_limit, images_used, …, resets_in}}` — everything the dashboard header needs in one call **[PROPOSED shape]**.

### 4.2 Projects
- `GET /api/projects?type=&status=&q=` → paginated list **[OBSERVED]**
- `POST /api/projects` `{type, name, config}` → `201 {project}` **[OBSERVED]**
- `GET /api/projects/:id` → `200 {project, jobs: [...]}` **[OBSERVED]**
- `PATCH /api/projects/:id`, `DELETE /api/projects/:id` **[PROPOSED]**
- `GET /api/projects/templates` — viral niche templates **[PROPOSED]** (route exists: `/projects/templates`)

### 4.3 Voices **[OBSERVED paths]**
- `GET /api/voices?language=&gender=&country=&q=&page=` → `{voices: [{id, name, gender, language, country, preview_url}], total}`
- `GET /api/voices/languages` → `{languages: [{code, name, voice_count}]}`

### 4.4 Tools — the `/generate` vs `/start` contract
**[PROPOSED]** rule that fits both observed names:
- `POST …/generate` (tts, bulk-images): **synchronous, 202-style with short timeout** — validates entitlement + quota, reserves quota, calls provider, returns `{artifact}` or `{job_id}` if the provider is slow. Single TTS under ~30s returns audio directly.
- `POST …/start` (bulk-videos, first-last-video, and by extension long-video/ugc/lip-sync): **always async** — validates, reserves quota, creates `jobs` row, enqueues BullMQ job, returns `202 {job_id, status: "queued"}`.
- `GET /api/jobs` (my-jobs page), `GET /api/jobs/:id` → `{job: {status, progress, result, error}}`, `POST /api/jobs/:id/cancel`.

Per-tool endpoints (paths follow the observed `/api/tools/<tool>/<action>` convention):
- `POST /api/tools/tts/generate` `{voice_id, text}` — quota: `len(text)` chars.
- `POST /api/tools/multi-character-tts/generate` `{segments: [{voice_id, text}]}` **[PROPOSED]**.
- `POST /api/tools/bulk-images/generate` `{prompts[], style, aspect}` — quota: images count.
- `POST /api/tools/bulk-videos/start` `{project_name, model, style, aspect_ratio, cc_mode, prompts[]}` — quota: scenes count; plan gate: `bulk_tools` (Free blocked **[OBSERVED: Free gets bounced]**).
- `POST /api/tools/first-last-video/start` `{first_image, last_image, prompt, …}`.
- `POST /api/tools/video-studio/start` (long videos), `/lip-sync/start`, `/ugc-ads/start`, `/bulk-images-to-video/start` **[PROPOSED, same pattern]**.
- `POST /api/tools/youtube/niche-finder` `{niche}` → fast analysis; quota: `niche_analyses_daily`; 24h result cache **[PROPOSED]**.
- `POST /api/tools/youtube/seo-generator`, `/tags-generator`, `/channel-analyzer` — same pattern **[PROPOSED]**.
- `POST /api/tools/image-to-prompt`, `/video-breakdown`, `/video-master-prompt` — single-shot AI calls, token-metered **[PROPOSED]**.

### 4.5 Billing, API keys, misc
- `GET /api/plans` → public plan catalog **[PROPOSED]**.
- `POST /api/billing/upgrade-request` `{plan_slug}` → creates pending subscription + notifies admin **[PROPOSED]** (matches "Contact to Upgrade").
- `GET/POST/DELETE /api/api-keys`, `POST /api/api-keys/:id/revoke` **[PROPOSED]**.
- `GET /api/branding/:asset` → tenant logo/favicon **[OBSERVED]**.
- `GET/POST /api/support/tickets`, `GET/POST /api/ai-chat/threads…` **[PROPOSED]**.

### 4.6 Middleware order (every tool route)
`auth → plan entitlement (403 if tool gated) → quota check (429 if exhausted) → quota reserve → handler/enqueue → on failure: release reservation` **[PROPOSED]**. Never trust the client for limits.

---

## 5. Job pipeline (BullMQ)

**[PROPOSED]**

### 5.1 Queues
| Queue | Tools | Concurrency model |
|---|---|---|
| `video` | bulk-videos, first-last-video, video-studio, lip-sync, ugc-ads, bulk-images-to-video | worker pool; per-user active-job cap = `plan.threads` |
| `image` | bulk-images | higher concurrency, fast tasks |
| `tts` | overflow/long TTS | sync-first, queue fallback |
| `analysis` | youtube tools, image-to-prompt, breakdowns | fast, cached |

### 5.2 Lifecycle
`queued → active (progress % written to jobs.progress) → completed (artifacts rows + result JSON) | failed (error, attempts, exponential backoff ×3) | cancelled`. BullMQ job id stored on the `jobs` row; **idempotency_key** (client-supplied or hash of params) prevents double-submit on retry **[PROPOSED]**.

### 5.3 Priority
`priority_queue` plan flag → BullMQ priority on the job **[PROPOSED]**. Free jobs deprioritized behind paid — matches the "Priority queue" feature line on paid plans **[OBSERVED]**.

### 5.4 Provider abstraction
```ts
interface MediaProvider {
  generateVideo(params): Promise<ProviderJob>;
  generateImage(params): Promise<Artifact>;
  synthesizeSpeech(params): Promise<Artifact>;
  getJobStatus(id): Promise<{status, progress, result?}>;
}
```
Concrete adapters (Google Flow VEO label seen in UI **[OBSERVED]**; ElevenLabs for TTS **[OBSERVED]**) plug in here. Workers never import a provider directly — only the interface **[PROPOSED]**. Which accounts/keys you hold decides which adapters we implement first (open question §8).

---

## 6. Quota & billing logic

### 6.1 Daily quotas **[OBSERVED limits, PROPOSED mechanics]**
Free plan (observed): 1 thread · 2-min max video · 1 scene/cycle · 100 TTS chars/day · 10 niche analyses/day · 1 image/day · daily reset.
- Check-and-decrement in Redis (atomic Lua), keyed `quota:{user_id}:{YYYY-MM-DD}`; workers reconcile to `daily_usage` in Postgres.
- "Day" = **server-local midnight** **[PROPOSED default]** — the dashboard's "Resets in 23h 51m" is computed from this. (User-timezone midnight is the alternative; needs a stored tz per user.)
- On job failure/cancellation, reserved quota is released.

### 6.2 Billing = manual in v1 **[OBSERVED "Contact to Upgrade" → PROPOSED flow]**
1. User clicks Contact to Upgrade → `POST /api/billing/upgrade-request` → `subscriptions` row with `status='pending'`, admin notified.
2. Admin (future `/admin`, or direct DB in v0) verifies payment off-platform → sets `status='active'`, `plan_id`, dates.
3. Downgrade/expiry → user falls back to Free; quotas recompute from the new plan immediately.
- No payment gateway in v1. Razorpay/Stripe is an R5+ option (open question §8). Invoices: `invoices` table only when a gateway lands.

### 6.3 Child panel (Rs 20,000 one-time, **[OBSERVED]**)
`child_panels` row + `subscriptions` (one-time, `ends_at=NULL`) → tenant gets branded `/api/branding/*` assets and (later) isolated subdomain. v1: branding + plan override only.

---

## 7. Non-functional requirements **[PROPOSED]**

- **Rate limiting**: per-IP (login: 10/min) + per-user (tool routes: 60/min) via Redis; 429 with `Retry-After`.
- **Validation**: Fastify schemas (JSON Schema) on every route — generated TS types from the same schemas.
- **Secrets**: `.env` via Connections/Vault; never in repo. Provider keys per-environment.
- **Observability**: structured JSON logs, `/health` + `/ready` endpoints, BullMQ board (internal only).
- **Backups**: nightly Postgres dumps (7-day retention) — VPS cron in v1.
- **Tests**: contract tests for every route (schema-validated), worker unit tests with mocked providers.

---

## 8. Open decisions (need your call)

| # | Question | Recommendation |
|---|---|---|
| 1 | Auth transport: Bearer JWT in `Authorization` header vs httpOnly cookie? | **Bearer** — simplest for the static frontend + future mobile/API use; 15-min access + 7-day rotating refresh. |
| 2 | "Day" boundary for quota reset: server midnight vs each user's timezone? | **Server midnight** for v1 (one code path); user-tz later. |
| 3 | Which provider accounts do you actually hold — ElevenLabs? Which video model API? | **Adapter pattern** means we build the interface now; implement adapters for whichever keys you have. Tell me what exists. |
| 4 | Payment gateway now or later? (Site says "Contact to Upgrade" — manual.) | **Manual v1** as designed above; Razorpay when volume justifies it. |
| 5 | Job progress: polling (proposed) vs WebSocket/SSE? | **Polling** v1 — matches the static pages, zero infra. |
| 6 | Artifact storage: local disk v1 vs S3-compatible from day one? | **Local disk behind the storage interface** — migrate without code changes later. |

---

## 9. Phased implementation (releases)

- **R1 — Foundation**: auth, users, plans, quota ledger, projects CRUD, jobs infra, BullMQ wiring, Docker Compose. (Unlocks: login, dashboard quotas, my-jobs shell.)
- **R2 — Audio**: voices catalog + sync, TTS generate, multi-character TTS, voice history.
- **R3 — Video pipelines**: bulk-videos, first-last-frame, long-video studio, bulk-images-to-video, lip-sync, UGC ads + provider adapters.
- **R4 — YouTube automation**: niche finder, SEO generator, tags, channel analyzer (+ cache).
- **R5 — Money & platform**: manual billing flow, API keys, affiliate, child panels, AI chat/support tickets.
- **R6 — Hardening**: rate limits, tests, backups, docs, admin basics.

Each release is independently deployable; the static frontend already exists for all of them.

---

*End of blueprint v1 — awaiting confirmation before R1 design begins.*
