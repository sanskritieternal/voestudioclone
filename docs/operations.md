# Operations runbook — VEO Studio Ai clone backend

R6. For day-to-day running, backup/restore, and troubleshooting. The API
itself is documented in `app/api-docs/` (served from the frontend).

## Layout

- `backend/` — Fastify API (`src/index.ts`), BullMQ worker (`src/worker.ts`), CLI (`src/cli.ts`)
- `docker-compose.yml` (repo root) — postgres + redis + api + worker + nginx
- `backend/.env` — secrets and config (gitignored, never committed)

## Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres connection string |
| `REDIS_URL` | yes | — | Redis connection string |
| `JWT_SECRET` | yes | — | Long random string; rotation logs everyone out |
| `PORT` | no | `8080` | API listen port |
| `PROVIDER_MODE` | no | `stub` | `stub` = deterministic fake media; `live` = real provider chain |
| `ARTIFACT_DIR` | no | `/data/artifacts` | Generated media storage |
| `ELEVENLABS_API_KEY` | no | — | Or set via API Keys page (DB wins over env) |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | no | — | Same |
| `FAL_KEY`, `REPLICATE_API_TOKEN`, `TOGETHER_API_KEY`, `SELF_HOSTED_API_KEY` | no | — | Same |
| `YOUTUBE_API_KEY` | no | — | Same |
| `JWT_ACCESS_TTL` | no | `900` | Access token seconds |
| `JWT_REFRESH_TTL_DAYS` | no | `7` | Refresh token days |
| `WORKER_CONCURRENCY` | no | `4` | BullMQ worker concurrency |

Provider keys can live in `.env` **or** in the `provider_credentials` table
(API Keys page → `PUT /api/providers/:name/key`). The DB value wins; the API
never returns key values (write-only).

## Deploy (VPS, Docker Compose)

```sh
git pull
cp backend/.env.example backend/.env   # first time only; fill in secrets
docker compose up -d --build
docker compose exec api node dist/migrate.js   # migrations are idempotent
```

Check health: `curl http://localhost:8080/api/health` (or via nginx).

## CLI admin

```sh
cd backend
node dist/cli.js create-user --email you@example.com --password '...' [--plan personal-max-quality]
node dist/cli.js list-users                 # plans + today's quota usage
node dist/cli.js user-info --email x@y.z
node dist/cli.js set-plan --email x@y.z --plan personal-eco
node dist/cli.js sync-voices                # refresh ElevenLabs voice catalog
```

## Backups

```sh
cd backend
./scripts/backup.sh
```

Writes `BACKUP_DIR` (default `backend/backups/`):
`veo-db-<stamp>.dump` (pg_dump custom format) and
`veo-artifacts-<stamp>.tar.gz`. Keeps the last 7 of each by default
(`BACKUP_KEEP`). Run it from cron for daily backups:

```cron
0 3 * * * cd /opt/veoclone/backend && ./scripts/backup.sh >> /var/log/veo-backup.log 2>&1
```

### Restore

```sh
# database (to a fresh database; never over the live one without stopping the API first)
pg_restore --no-owner --dbname="$DATABASE_URL" backups/veo-db-<stamp>.dump

# artifacts
tar -xzf backups/veo-artifacts-<stamp>.tar.gz -C /data/
```

Quota counters live in Redis and reset daily; they are intentionally **not**
backed up. `daily_usage` (Postgres) is the durable ledger.

## Tests

```sh
cd backend
npm test     # builds, then runs node --test against a disposable veo_test DB + Redis db 1
```

17 integration tests: auth (login/refresh rotation/logout), AI chat
(503-without-key path, quota release, burst limiter), support tickets,
provider keys + registry admin, quota reserve/release. Your dev database is
never touched.

## Rate limits

- Global: 120 req/min per authenticated user (`authedLimiter`, Redis fixed window)
- Login: 10 req/min per IP
- Expensive endpoints (LLM chat messages, sync TTS/SFX, YouTube analyses,
  voice design/clone): 30 req/min per user (`expensiveLimiter`)
- Daily spend guards: per-plan quotas in Redis (atomic Lua), ledger in
  `daily_usage`. A 429 from quota returns `quota_exhausted` with the field,
  limit, and used values.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `llm_not_configured` (503) on chat/YouTube tools | No LLM provider key | Add a Gemini key on the API Keys page, or enable another `llm` row in `/providers` |
| `*_not_configured` on TTS | No TTS provider key | Same — ElevenLabs key or another `tts` row |
| Jobs stuck in `queued` | Worker not running | `docker compose up -d worker`; check `docker compose logs worker` |
| `quota_exhausted` (429) | Daily plan quota hit | Wait for server-midnight reset, or `set-plan` to the other routing profile |
| `rate_limited` (429) | Burst limiter | Back off; `retry_after_sec` tells how long |
| API 500s after deploy | Migrations not run | `docker compose exec api node dist/migrate.js` |
| Frontend shows demo numbers | `veo_api_base` not set | Point it at the API origin; token in `veo_token` |

## Security notes (personal-use hardening)

- JWTs are Bearer tokens in `localStorage`; treat XSS as the main threat —
  don't paste untrusted HTML into the app's pages.
- Provider keys are write-only in the API and never leave the server except
  to the provider itself.
- `backend/.env` is gitignored. Never commit it, never paste keys into chat
  logs or docs.
- The test suite (`npm test`) uses `veo_test` + Redis db 1; it truncates all
  tables there on every run. Never point it at the live database.
