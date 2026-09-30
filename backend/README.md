# VEO Studio Backend — R5 Personal Platform

Fastify + Postgres + Redis/BullMQ. See `../docs/backend-blueprint.md` for the full design.

## R5 scope (delivered)

- **AI chat** (`/api/ai-chat`): per-user threads + messages. `POST /threads/:id/messages` saves the user message, runs it through the LLM provider chain (history folded into one prompt; the stub is skipped — no fabricated replies), saves the assistant reply with token estimates (chars/4, same convention as the Gemini adapter), and auto-titles the thread from the first message. Charged to the existing `ai_tokens_in`/`ai_tokens_out` quota: input reserved upfront from the estimate, over-reservation refunded, actuals reconciled to the PG ledger. No LLM key → `503 llm_not_configured`; the failed user message is rolled back so the thread stays clean.
- **Support tickets** (`/api/support`): create/list (status filter)/view/change-status/reply/delete; replies bump `updated_at`. Backs the Support page.
- **Provider registry admin** (`/api/providers`): `POST /` adds a row (disabled by default, priority appended — explicit opt-in before it joins a live chain), `PUT /:name` edits enabled/priority/model/cost/endpoint/config, `POST /:name/move` reorders within its capability chain, `DELETE /:name` removes the row. Routing rules = per-capability priority order + enable flags; changes apply to the next request, no restart.
- **Frontend**: AI Chat page wired (thread list, bubbles, typing indicator, suggestion chips, honest 503 card linking to API Keys); Support page wired (status tabs, ticket detail with replies, status changer); new **Provider Registry** page (`/providers`, linked from the API Keys provider card); dashboard AI Token Usage cards now show today's real `ai_tokens` quota instead of the demo numbers.
- Smoke-tested: chat 503 path (quota released, message rolled back), threads CRUD, tickets CRUD + status + replies, registry add/enable/move/delete. Full chat success path needs a real Gemini key (vaibhav pastes it on the API Keys page).

## R4 scope (delivered)

- **YouTube automation API** (`/api/youtube`): niche finder (search ordered by viewCount → avg/median views, competition heuristic, opportunity score), channel analyzer (stats + 30-day activity + top 10 recent videos), video breakdown (metadata, tags, description), SEO generator, tags generator, master prompt (all three LLM-generated via the provider chain — no fabricated output). Handles (`@handle`) resolve to channel IDs. Results cached per user for 24h (`youtube_analyses`); history list/view/delete endpoints.
- **Honest failures**: without a YouTube Data API key → `503 youtube_not_configured`; without an LLM key → `503 llm_not_configured` (the LLM tools refuse to fabricate SEO/tags); bad key / upstream error → `502` with the real provider message. Frontend links straight to the API Keys page.
- **Quota fairness**: charged to the existing `niche_analyses` daily dimension; cache hits and validation/config failures cost nothing (quota reserved only on cache miss, released via `releaseQuota` when the request never touched the upstream); a 25s timeout bounds hung YouTube calls.
- **Frontend**: the 7 YouTube tool pages are live against the API (shared `app/assets/js/yt-tools.js`), incl. the history page with search/filter/view/delete.
- Smoke-tested: error paths (503/502/400/404/429-shape), credential set/clear/status (values never leak), quota charging/release, plan switching, history CRUD. A full success-path test needs real YouTube + Gemini keys.

## Provider credentials (UI-managed keys)

Provider API keys no longer have to live in env vars. The **API Keys page → Provider integrations** section (backed by `provider_credentials`, migration 007, `PUT/DELETE /api/providers/:name/key`) stores keys per provider in Postgres; `GET /api/providers` reports configured/source (`db|env|none`) but never values. Resolution order: **DB value wins, env var is the fallback**. All adapters (ElevenLabs, Gemini, fal/Replicate/Together/self-hosted, YouTube) resolve keys through `providerKey()` — existing env deployments keep working unchanged.

## R3 scope (delivered)

- **Real Gemini adapter** (`src/services/providers/gemini.ts`): native transport for `video` (Veo `:predictLongRunning` → MP4 download), `image` (Imagen `:predict` → PNG), `llm` (`generateContent` → `.txt` artifact) and `tts` (audio modality → WAV). Needs `GEMINI_API_KEY` (or `GOOGLE_API_KEY`); without it the adapter reports `gemini_not_configured` and the chain yields to the stub.
- **HttpApiProvider** (`src/services/providers/httpApi.ts`): one generic adapter for the `fal`, `replicate`, `together` and `self-hosted` transports, driven entirely by the provider registry row (model, base URL overrides, cost). Keys: `FAL_KEY`, `REPLICATE_API_TOKEN`, `TOGETHER_API_KEY`, `SELF_HOSTED_API_KEY`. The `self-hosted` transport is config-driven via the row's `config` jsonb (submit/poll paths, template substitution, JSON-path result extraction) — the escape hatch for any custom GPU endpoint.
- **Registry wiring**: `resolveProviders()` now instantiates Gemini for `gemini` rows and `HttpApiProvider` for fal/replicate/together/self-hosted rows (migration 006 seeds reference prices + a disabled `flux-image-fal` row). Disabled rows are skipped; unconfigured adapters yield; real API errors fail loudly.
- **Long-job polling**: adapters can return `pollInMs` on processing polls (video polls every 20s, not every 2.5s); remote media URLs are downloaded into the job's artifact dir so `/artifacts/...` URLs keep working.
- **Cost fix**: async video/image jobs now log `tool` in `provider_cost_log` (was null for the generic chain path).
- Smoke-tested: no-key mode falls through to stub (video + image); adapter integration-tested against a local fake fal.ai queue server (submit → poll → download → cost 0.25 logged).

## R2 scope (delivered)

- **Real ElevenLabs adapter** (`src/services/providers/elevenlabs.ts`): TTS (PCM → WAV), voice catalog sync (`npm run cli -- sync-voices`), sound effects, voice design, voice clone. Needs `ELEVENLABS_API_KEY` in `.env`; without it the adapter reports `elevenlabs_not_configured` and the chain yields to the stub.
- **Fallback semantics**: an *unconfigured* provider yields to the next provider in the chain; any other error (bad key, 4xx/5xx) fails the job loudly instead of silently producing stub artifacts. See `isNotConfiguredError()` in `src/services/providers.ts`.
- **Voice-lab tools**: `POST /api/tools/sfx/generate` (sync), `/multi-character-tts/start`, `/voice-design/start`, `/voice-clone/start` (multipart, async). Multi-character synthesizes each segment with its own voice and concatenates into one WAV.
- **Spend dashboard API**: `GET /api/spend/summary?days=30` (totals + by provider/capability/tool), `GET /api/spend/daily?days=30`. Cost rows now carry the `tool` column (migration 005). Frontend page at `/spend` (replaces `/billing`; the old URL redirects).
- Frontend: `/billing` → `/spend` redirect; sidebar "Billing & Payments" → "Spend"; dropped commercial pages (Affiliate, Child Panel, Offers) removed from nav and deleted. Plans page kept (routing profiles).

## R1 scope (foundation)

- Auth: `POST /api/auth/login`, `/refresh`, `/logout`, `GET /api/auth/me` (Bearer JWT, 15-min access + 7-day rotating refresh)
- Plans as **routing profiles** (`personal-max-quality`, `personal-eco`) — personal use, no billing
- Quota ledger: Redis atomic check-and-decrement + Postgres `daily_usage` (spend guards, server-midnight reset)
- Projects CRUD + templates stub
- Jobs: `GET /api/jobs`, `GET /api/jobs/:id`, `POST /api/jobs/:id/cancel` (polling for progress)
- Tools: `POST /api/tools/tts/generate` (sync), `/bulk-images/generate`, `/bulk-videos/start`, `/first-last-video/start`, `/video-studio/start`, `/lip-sync/start`, `/ugc-ads/start`, `/bulk-images-to-video/start` (async, 202 + job id)
- Voices catalog endpoints (populated by R2 sync), plans list, branding assets
- BullMQ queues `video|image|tts|analysis` + worker; stub provider still the final fallback (writes viewable SVG slates / silent WAVs, marked `stub:true` in artifact meta)
- Provider registry table seeded (ElevenLabs native enabled; Gemini adapter in R3; fal/Replicate/Together/self-hosted disabled until keys configured)
- Cost logging table (`provider_cost_log`) with per-tool breakdown — see Spend above

## Local dev

```bash
cd backend
cp .env.example .env   # fill JWT_SECRET (and create veo/veo db in local postgres)
npm install
npm run migrate
npm run cli -- create-user --email you@example.com --password secret --plan personal-max-quality
npm run dev            # API on :8080
npm run dev:worker     # worker (separate terminal)
```

## Docker (VPS)

```bash
JWT_SECRET=<long-random> docker compose up --build -d
# then create your user:
docker compose exec api node dist/cli.js create-user --email you@example.com --password secret
```

Open http://localhost:8080 — nginx serves the static frontend and proxies `/api/*`.

## Smoke test

```bash
# login
TOKEN=$(curl -s -X POST localhost:8080/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"secret"}' | node -p "JSON.parse(require('fs').readFileSync(0)).token")
# me (plan + quotas)
curl -s localhost:8080/api/auth/me -H "Authorization: Bearer $TOKEN" | head -c 400
# start a bulk video job (stub completes in ~12s)
JOB=$(curl -s -X POST localhost:8080/api/tools/bulk-videos/start -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"project_name":"demo","prompts":["a cat astronaut"]}' | node -p "JSON.parse(require('fs').readFileSync(0)).job_id")
# poll
curl -s localhost:8080/api/jobs/$JOB -H "Authorization: Bearer $TOKEN"
```

## What's stubbed (honest list)

- Video/image providers are still `StubProvider` (no real Gemini/fal/Replicate/Together calls yet). TTS has the real ElevenLabs adapter but falls back to stub until `ELEVENLABS_API_KEY` is set. Artifacts are clearly marked `stub:true` in their meta.
- YouTube automation tools → R4 ✅ delivered. API keys management (UI provider-key store) → R4 ✅ delivered. AI chat, support tickets → R5.
