import type { FastifyInstance } from 'fastify';
import { db } from '../db';
import { credentialStatus, setProviderKey, clearProviderKey, KNOWN_PROVIDERS } from '../services/credentials';

/**
 * Provider integrations (R4 enabler) + registry admin (R5).
 *
 * Lets vaibhav manage provider API keys from the API Keys page instead of
 * editing .env. Key values are write-only: the API returns only
 * configured/not-configured + source (db | env | none), never the value.
 *
 * R5 adds registry administration: add/update/remove provider rows and set
 * routing order (priority, lower = tried first) plus enable flags — this is
 * the routing rule surface for every capability chain.
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

  // ---- R5: registry admin ----
  //
  // Routing rules are per-capability priority order (lower = tried first) +
  // enabled flags. Changing them takes effect on the next chain resolution;
  // workers/API processes resolve the chain per request.

  // Add a registry row (e.g. a new self-hosted endpoint).
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'capability', 'transport'],
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 80 },
          capability: { type: 'string', enum: ['tts', 'video', 'image', 'llm'] },
          transport: { type: 'string', enum: ['native', 'fal', 'replicate', 'together', 'self-hosted'] },
          default_model: { type: 'string', maxLength: 200 },
          cost_per_unit: { type: 'number', minimum: 0 },
          endpoint: { type: 'string', maxLength: 500 },
          config: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const { name, capability, transport, default_model, cost_per_unit, endpoint, config } = req.body as Record<string, any>;
    const exists = await db.selectFrom('provider_registry').select('id').where('name', '=', name).executeTakeFirst();
    if (exists) return reply.code(409).send({ error: 'provider_exists', provider: name });
    const max = await db.selectFrom('provider_registry').select((eb) => eb.fn.max('priority').as('m')).executeTakeFirst();
    // Seed rows use "<name>-<capability>" ids; keep the convention.
    let pid = `${name}-${capability}`;
    let n = 2;
    while (await db.selectFrom('provider_registry').select('id').where('id', '=', pid).executeTakeFirst()) pid = `${name}-${capability}-${n++}`;
    const row = await db
      .insertInto('provider_registry')
      .values({
        id: pid,
        name, capability, transport,
        priority: (Number(max?.m ?? 0) + 10),
        enabled: false, // explicit opt-in before it joins a live chain
        endpoint: endpoint ?? null,
        default_model: default_model ?? null,
        cost_per_unit: cost_per_unit ?? null,
        config: config ?? {},
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { provider: row };
  });

  // Update routing fields of a row.
  app.put('/:name', {
    schema: {
      body: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          priority: { type: 'integer', minimum: 0 },
          default_model: { type: 'string', maxLength: 200 },
          cost_per_unit: { type: 'number', minimum: 0 },
          endpoint: { type: 'string', maxLength: 500 },
          config: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const { name } = req.params as { name: string };
    const { enabled, priority, default_model, cost_per_unit, endpoint, config } = req.body as Record<string, any>;
    const row = await db.selectFrom('provider_registry').select('id').where('name', '=', name).executeTakeFirst();
    if (!row) return reply.code(404).send({ error: 'unknown_provider', provider: name });
    const patch: Record<string, any> = {};
    if (enabled !== undefined) patch.enabled = enabled;
    if (priority !== undefined) patch.priority = priority;
    if (default_model !== undefined) patch.default_model = default_model;
    if (cost_per_unit !== undefined) patch.cost_per_unit = cost_per_unit;
    if (endpoint !== undefined) patch.endpoint = endpoint;
    if (config !== undefined) patch.config = config;
    const updated = await db
      .updateTable('provider_registry')
      .set(patch)
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { provider: updated };
  });

  // Move a row up/down in its capability chain (swap priorities with neighbour).
  app.post('/:name/move', {
    schema: { body: { type: 'object', required: ['direction'], properties: { direction: { type: 'string', enum: ['up', 'down'] } } } },
  }, async (req, reply) => {
    const { name } = req.params as { name: string };
    const { direction } = req.body as { direction: 'up' | 'down' };
    const row = await db.selectFrom('provider_registry').select(['id', 'capability', 'priority']).where('name', '=', name).executeTakeFirst();
    if (!row) return reply.code(404).send({ error: 'unknown_provider', provider: name });
    const neighbour = await db
      .selectFrom('provider_registry')
      .select(['id', 'priority'])
      .where('capability', '=', row.capability)
      .where('id', '!=', row.id)
      .where('priority', direction === 'up' ? '<' : '>', row.priority)
      .orderBy('priority', direction === 'up' ? 'desc' : 'asc')
      .executeTakeFirst();
    if (!neighbour) return reply.code(409).send({ error: 'no_neighbour', message: 'Already at the end of its chain.' });
    await db.updateTable('provider_registry').set({ priority: neighbour.priority }).where('id', '=', row.id).execute();
    await db.updateTable('provider_registry').set({ priority: row.priority }).where('id', '=', neighbour.id).execute();
    return { ok: true };
  });

  // Remove a registry row (does not touch stored keys).
  app.delete('/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const row = await db.selectFrom('provider_registry').select('id').where('name', '=', name).executeTakeFirst();
    if (!row) return reply.code(404).send({ error: 'unknown_provider', provider: name });
    await db.deleteFrom('provider_registry').where('id', '=', row.id).execute();
    return { ok: true };
  });
}
