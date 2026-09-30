import 'dotenv/config';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

function opt(name: string, dflt: string): string {
  return process.env[name] ?? dflt;
}

function num(name: string, dflt: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return dflt;
  const v = parseInt(raw, 10);
  if (Number.isNaN(v)) throw new Error(`Env var ${name} must be a number`);
  return v;
}

export const config = {
  nodeEnv: opt('NODE_ENV', 'development'),
  port: num('PORT', 8080),
  databaseUrl: req('DATABASE_URL'),
  redisUrl: req('REDIS_URL'),
  jwtSecret: req('JWT_SECRET'),
  accessTtlSec: num('JWT_ACCESS_TTL', 900),
  refreshTtlDays: num('JWT_REFRESH_TTL_DAYS', 7),
  artifactDir: opt('ARTIFACT_DIR', '/data/artifacts'),
  providerMode: opt('PROVIDER_MODE', 'stub') as 'stub' | 'live',
  workerConcurrency: num('WORKER_CONCURRENCY', 4),
  // R2: ElevenLabs (native TTS transport). Empty = adapter falls back to the next provider in the chain.
  elevenlabsApiKey: opt('ELEVENLABS_API_KEY', ''),
  elevenlabsBase: opt('ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io'),
};

if (config.nodeEnv === 'production' && config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 chars in production');
}
