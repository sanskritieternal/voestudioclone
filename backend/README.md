# VEO Studio Backend — R1 Foundation

Fastify + Postgres + Redis/BullMQ. See `../docs/backend-blueprint.md` for the full design.

## R1 scope

- Auth: `POST /api/auth/login`, `/refresh`, `/logout`, `GET /api/auth/me` (Bearer JWT, 15-min access + 7-day rotating refresh)
- Plans as **routing profiles** (`personal-max-quality`, `personal-eco`) — personal use, no billing
- Quota ledger: Redis atomic check-and-decrement + Postgres `daily_usage` (spend guards, server-midnight reset)
- Projects CRUD + templates stub
- Jobs: `GET /api/jobs`, `GET /api/jobs/:id`, `POST /api/jobs/:id/cancel` (polling for progress)
- Tools: `POST /api/tools/tts/generate` (sync), `/bulk-images/generate`, `/bulk-videos/start`, `/first-last-video/start`, `/video-studio/start`, `/lip-sync/start`, `/ugc-ads/start`, `/bulk-images-to-video/start` (async, 202 + job id)
- Voices catalog endpoints (empty until R2 sync), plans list, branding assets
- BullMQ queues `video|image|tts|analysis` + worker with **stub provider** (writes viewable SVG slates / silent WAVs) — live adapters in R2/R3
- Provider registry table seeded (ElevenLabs/Gemini native enabled; fal/Replicate/Together/self-hosted disabled until keys configured)
- Cost logging table (`provider_cost_log`) — Spend dashboard in R2

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

- All providers are `StubProvider` (`PROVIDER_MODE=stub`): no real ElevenLabs/Gemini/fal/Replicate/Together calls yet. Artifacts are clearly marked `stub:true` in their meta.
- YouTube automation tools → R4. API keys management, AI chat, support tickets → R5. Spend dashboard → R2.
