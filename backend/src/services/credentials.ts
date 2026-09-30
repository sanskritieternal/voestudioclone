import { db } from '../db';

/**
 * Provider credential store (R4 enabler).
 *
 * Lets vaibhav manage provider API keys from the API Keys page instead of
 * editing .env. Resolution order per provider: DB credential first, then the
 * documented env var(s). The raw key value never leaves this module except
 * into an outbound provider request.
 */

export const KNOWN_PROVIDERS = [
  'elevenlabs',
  'gemini',
  'fal',
  'replicate',
  'together',
  'self-hosted',
  'youtube',
] as const;

export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

const ENV_FALLBACK: Record<string, string[]> = {
  elevenlabs: ['ELEVENLABS_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  fal: ['FAL_KEY'],
  replicate: ['REPLICATE_API_TOKEN'],
  together: ['TOGETHER_API_KEY'],
  'self-hosted': ['SELF_HOSTED_API_KEY'],
  youtube: ['YOUTUBE_API_KEY'],
};

function isKnown(name: string): name is KnownProvider {
  return (KNOWN_PROVIDERS as readonly string[]).includes(name);
}

/** Resolve the API key for a provider: DB credential wins, env var is fallback. */
export async function providerKey(name: string): Promise<string> {
  if (!isKnown(name)) return '';
  const row = await db
    .selectFrom('provider_credentials')
    .select('api_key')
    .where('provider_name', '=', name)
    .executeTakeFirst();
  if (row?.api_key) return row.api_key;
  for (const env of ENV_FALLBACK[name] ?? []) {
    const v = process.env[env];
    if (v) return v;
  }
  return '';
}

/** Where the currently-effective key comes from: 'db' | 'env' | 'none'. Never returns the value. */
export async function keySource(name: string): Promise<'db' | 'env' | 'none'> {
  if (!isKnown(name)) return 'none';
  const row = await db
    .selectFrom('provider_credentials')
    .select('provider_name')
    .where('provider_name', '=', name)
    .executeTakeFirst();
  if (row) return 'db';
  for (const env of ENV_FALLBACK[name] ?? []) {
    if (process.env[env]) return 'env';
  }
  return 'none';
}

export async function setProviderKey(name: string, key: string): Promise<void> {
  if (!isKnown(name)) throw new Error(`unknown_provider: ${name}`);
  const value = key.trim();
  if (!value) throw new Error('empty_key');
  await db
    .insertInto('provider_credentials')
    .values({ provider_name: name, api_key: value, updated_at: new Date() })
    .onConflict((oc) =>
      oc.column('provider_name').doUpdateSet({ api_key: value, updated_at: new Date() }),
    )
    .execute();
}

export async function clearProviderKey(name: string): Promise<void> {
  if (!isKnown(name)) throw new Error(`unknown_provider: ${name}`);
  await db.deleteFrom('provider_credentials').where('provider_name', '=', name).execute();
}

/** Status list for the API Keys page: configured flag + source, never the value. */
export async function credentialStatus(): Promise<
  Array<{ provider: string; configured: boolean; source: 'db' | 'env' | 'none' }>
> {
  const out: Array<{ provider: string; configured: boolean; source: 'db' | 'env' | 'none' }> = [];
  for (const p of KNOWN_PROVIDERS) {
    const source = await keySource(p);
    out.push({ provider: p, configured: source !== 'none', source });
  }
  return out;
}
