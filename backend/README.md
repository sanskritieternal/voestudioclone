# VEO Studio Backend — R2 Audio + Spend

Fastify + Postgres + Redis/BullMQ. See `../docs/backend-blueprint.md` for the full design.

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
- YouTube automation tools → R4. API keys management, AI chat, support tickets → R5.
