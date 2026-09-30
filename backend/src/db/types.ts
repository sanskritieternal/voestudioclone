import type { ColumnType, Generated } from 'kysely';

export interface PlanLimits {
  tts_chars_daily: number;
  images_daily: number;
  scenes_daily: number;
  niche_analyses_daily: number;
  ai_tokens_daily: number;
  threads: number;
  max_video_minutes: number;
  scenes_per_cycle: number;
}

export interface PlanFeatures {
  bulk_tools: boolean;
  api_access: boolean;
  priority_queue: boolean;
}

export interface Users {
  id: Generated<string>;
  email: string;
  password_hash: string;
  name: string;
  avatar_url: string | null;
  plan_id: string | null;
  status: Generated<string>;
  email_verified: boolean;
  created_at: Generated<Date>;
  last_login_at: Date | null;
}

export interface Plans {
  id: string;
  slug: string;
  name: string;
  price_inr: number | null;
  billing_period: string | null;
  limits: ColumnType<PlanLimits, PlanLimits, PlanLimits>;
  features: ColumnType<PlanFeatures, PlanFeatures, PlanFeatures>;
  is_active: Generated<boolean>;
}

export interface RefreshTokens {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Generated<Date>;
  revoked_at: Date | null;
}

export interface DailyUsage {
  user_id: string;
  day: string; // YYYY-MM-DD
  tts_chars: Generated<number>;
  images: Generated<number>;
  scenes: Generated<number>;
  niche_analyses: Generated<number>;
  ai_tokens_in: Generated<number>;
  ai_tokens_out: Generated<number>;
}

export interface Projects {
  id: Generated<string>;
  user_id: string;
  type: string;
  name: string;
  status: Generated<string>;
  config: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type JobStatus = 'queued' | 'active' | 'completed' | 'failed' | 'cancelled';

export interface Jobs {
  id: Generated<string>;
  user_id: string;
  project_id: string | null;
  tool: string;
  kind: string;
  capability: string;
  status: Generated<JobStatus>;
  progress: Generated<number>;
  params: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
  result: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  error: string | null;
  quota_reserved: ColumnType<Record<string, number> | null, Record<string, number> | null, Record<string, number> | null>;
  attempts: Generated<number>;
  bullmq_job_id: string | null;
  idempotency_key: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Artifacts {
  id: Generated<string>;
  job_id: string | null;
  user_id: string;
  kind: string; // audio | image | video
  url: string; // path relative to artifact root, served at /artifacts/...
  prompt: string | null;
  meta: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
  created_at: Generated<Date>;
}

export type Transport = 'native' | 'fal' | 'replicate' | 'together' | 'self-hosted';

export interface ProviderRegistry {
  id: string;
  name: string;
  capability: string; // tts | video | image | llm
  transport: Transport;
  priority: Generated<number>;
  enabled: Generated<boolean>;
  endpoint: string | null;
  auth_ref: string | null; // Vault/env key name — never the secret itself
  default_model: string | null;
  request_map: string | null; // named mapping for self-hosted transports
  cost_per_unit: number | null;
  timeout_ms: Generated<number>;
  config: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
}

export interface ProviderCredentials {
  provider_name: string;
  api_key: string;
  updated_at: Date;
}

export interface ProviderCostLog {
  id: Generated<string>;
  user_id: string | null;
  job_id: string | null;
  provider: string;
  capability: string;
  tool: string | null;
  units: number;
  cost_estimate: number | null;
  created_at: Generated<Date>;
}

export interface Voices {
  id: Generated<string>;
  provider: string;
  provider_voice_id: string;
  name: string;
  gender: string | null;
  language: string | null;
  country: string | null;
  preview_url: string | null;
  meta: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
  synced_at: Date | null;
}

export interface YoutubeAnalyses {
  id: Generated<string>;
  user_id: string;
  kind: string; // niche | seo | tags | channel
  input: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
  result: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
  created_at: Generated<Date>;
}

export interface ApiKeys {
  id: Generated<string>;
  user_id: string;
  key_hash: string;
  name: string;
  scopes: ColumnType<string[], string[], string[]>;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Generated<Date>;
}

export interface SchemaMigrations {
  name: string;
  applied_at: Generated<Date>;
}

export interface Database {
  schema_migrations: SchemaMigrations;
  users: Users;
  plans: Plans;
  refresh_tokens: RefreshTokens;
  daily_usage: DailyUsage;
  projects: Projects;
  jobs: Jobs;
  artifacts: Artifacts;
  provider_registry: ProviderRegistry;
  provider_cost_log: ProviderCostLog;
  provider_credentials: ProviderCredentials;
  voices: Voices;
  youtube_analyses: YoutubeAnalyses;
  api_keys: ApiKeys;
}
