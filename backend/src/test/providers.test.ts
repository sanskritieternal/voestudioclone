import { before, after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getApp, truncateAll, createUser, loginToken, authHeaders, closeTestEnv } from './setup';

describe('providers', () => {
  let app: Awaited<ReturnType<typeof getApp>>;
  before(async () => { app = await getApp(); });
  after(async () => { await closeTestEnv(); });
  beforeEach(async () => { await truncateAll(); });

  async function authed() {
    await createUser('provtest@example.com');
    return authHeaders(await loginToken(app, 'provtest@example.com'));
  }

  test('registry list never leaks key values', async () => {
    const h = await authed();
    const res = await app.inject({ method: 'GET', url: '/api/providers/', headers: h });
    assert.equal(res.statusCode, 200);
    const body = JSON.stringify(res.json());
    // Key values must never appear; only configured flags.
    assert.ok(!body.includes('sk-'), 'no key material in registry response');
    assert.ok((res.json() as any).providers.length > 0);
    assert.ok((res.json() as any).credentials.every((c: any) => 'configured' in c && !('key' in c)));
  });

  test('key set → configured → clear, write-only throughout', async () => {
    const h = await authed();
    const set = await app.inject({
      method: 'PUT', url: '/api/providers/gemini/key', headers: h,
      payload: { key: 'test-key-value-12345' },
    });
    assert.equal(set.statusCode, 200);
    assert.equal((set.json() as any).source, 'db');

    const list = await app.inject({ method: 'GET', url: '/api/providers/', headers: h });
    const creds = (list.json() as any).credentials.find((c: any) => c.provider === 'gemini');
    assert.equal(creds.configured, true);
    assert.equal(creds.source, 'db');

    const cleared = await app.inject({ method: 'DELETE', url: '/api/providers/gemini/key', headers: h });
    assert.equal(cleared.statusCode, 200);
    const list2 = await app.inject({ method: 'GET', url: '/api/providers/', headers: h });
    const creds2 = (list2.json() as any).credentials.find((c: any) => c.provider === 'gemini');
    assert.equal(creds2.configured, false);
  });

  test('unknown provider key operations 404', async () => {
    const h = await authed();
    const res = await app.inject({
      method: 'PUT', url: '/api/providers/nope/key', headers: h,
      payload: { key: 'test-key-value-12345' },
    });
    assert.equal(res.statusCode, 404);
  });

  test('registry admin: add (disabled) → enable → move → delete', async () => {
    const h = await authed();
    const added = await app.inject({
      method: 'POST', url: '/api/providers/', headers: h,
      payload: { name: 'testprov', capability: 'llm', transport: 'self-hosted', endpoint: 'http://x' },
    });
    assert.equal(added.statusCode, 200);
    assert.equal((added.json() as any).provider.enabled, false);

    const dupe = await app.inject({
      method: 'POST', url: '/api/providers/', headers: h,
      payload: { name: 'testprov', capability: 'llm', transport: 'self-hosted' },
    });
    assert.equal(dupe.statusCode, 409);

    const enabled = await app.inject({
      method: 'PUT', url: '/api/providers/testprov', headers: h,
      payload: { enabled: true, priority: 1 },
    });
    assert.equal(enabled.statusCode, 200);
    assert.equal((enabled.json() as any).provider.enabled, true);

    const moved = await app.inject({
      method: 'POST', url: '/api/providers/testprov/move', headers: h,
      payload: { direction: 'down' },
    });
    assert.equal(moved.statusCode, 200);

    const deleted = await app.inject({
      method: 'DELETE', url: '/api/providers/testprov', headers: h,
    });
    assert.equal(deleted.statusCode, 200);
    const gone = await app.inject({
      method: 'PUT', url: '/api/providers/testprov', headers: h,
      payload: { enabled: true },
    });
    assert.equal(gone.statusCode, 404);
  });
});
