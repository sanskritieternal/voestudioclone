import type { FastifyInstance } from 'fastify';
import { db } from '../db';
import { credentialStatus, setProviderKey, clearProviderKey, KNOWN_PROVIDERS } from '../services/credentials';

/**
 * Provider integrations (R4 enabler).
 *
 * Lets vaibhav manage provider API keys from the API Keys page instead of
 * editing .env. Key values are write-only: the API returns only
 * configured/not-configured + source (db | env | none), never the value.
 */
export default async function providerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // Registry rows + credential status (no key values).
  app.get('/', async () => {
    const rows = await db.selectFrom('provider_registry').selectAll().orderBy('priority').execute();
    const status = await credentialStatus();
    const byName = new Map(status.map((s) => [s.provider, s]));
    return {
      providers: rows.map((r) => ({
        id: r.id,
        name: r.name,
        capability: r.capability,
        transport: r.transport,
        enabled: r.enabled,
        priority: r.priority,
      })),
      credentials: KNOWN_PROVIDERS.map((p) => {
        const s = byName.get(p)!;
        return { provider: p, configured: s.configured, source: s.source };
      }),
    };
  });

  app.put('/:name/key', {
    schema: {
      body: {
        type: 'object',
        required: ['key'],
        properties: { key: { type: 'string', minLength: 8, maxLength: 500 } },
      },
    },
  }, async (req, reply) => {
    const { name } = req.params as { name: string };
    const { key } = req.body as { key: string };
    try {
      await setProviderKey(name, key);
    } catch (err: any) {
      if (String(err.message).startsWith('unknown_provider')) return reply.code(404).send({ error: 'unknown_provider', provider: name });
      if (err.message === 'empty_key') return reply.code(400).send({ error: 'empty_key' });
      throw err;
    }
    return { ok: true, provider: name, configured: true, source: 'db' as const };
  });

  app.delete('/:name/key', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      await clearProviderKey(name);
    } catch (err: any) {
      if (String(err.message).startsWith('unknown_provider')) return reply.code(404).send({ error: 'unknown_provider', provider: name });
      throw err;
    }
    return { ok: true, provider: name, configured: false };
  });
}
