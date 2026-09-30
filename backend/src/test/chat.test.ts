import { before, after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getApp, truncateAll, createUser, loginToken, authHeaders, closeTestEnv } from './setup';

describe('ai-chat', () => {
  let app: Awaited<ReturnType<typeof getApp>>;
  before(async () => { app = await getApp(); });
  beforeEach(async () => { await truncateAll(); });

  async function authed() {
    await createUser('chattest@example.com');
    return authHeaders(await loginToken(app, 'chattest@example.com'));
  }

  test('thread lifecycle: create, list, get, delete', async () => {
    const h = await authed();
    const created = await app.inject({ method: 'POST', url: '/api/ai-chat/threads', headers: h, payload: {} });
    assert.equal(created.statusCode, 200);
    const thread = (created.json() as any).thread;
    assert.ok(thread.id);

    const list = await app.inject({ method: 'GET', url: '/api/ai-chat/threads', headers: h });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().threads.length, 1);

    const gone = await app.inject({ method: 'DELETE', url: `/api/ai-chat/threads/${thread.id}`, headers: h });
    assert.equal(gone.statusCode, 200);
    const list2 = await app.inject({ method: 'GET', url: '/api/ai-chat/threads', headers: h });
    assert.equal(list2.json().threads.length, 0);
  });

  test('threads are isolated per user', async () => {
    const h1 = await authed();
    await createUser('chatother@example.com');
    const h2 = authHeaders(await loginToken(app, 'chatother@example.com'));
    const created = await app.inject({ method: 'POST', url: '/api/ai-chat/threads', headers: h1, payload: {} });
    const id = (created.json() as any).thread.id;
    const peek = await app.inject({ method: 'GET', url: `/api/ai-chat/threads/${id}`, headers: h2 });
    assert.equal(peek.statusCode, 404);
  });

  test('message without an LLM key: honest 503, quota released, thread untouched', async () => {
    const h = await authed();
    const created = await app.inject({ method: 'POST', url: '/api/ai-chat/threads', headers: h, payload: {} });
    const id = (created.json() as any).thread.id;

    const msg = await app.inject({
      method: 'POST', url: `/api/ai-chat/threads/${id}/messages`,
      headers: h, payload: { content: 'Hello, is anyone there?' },
    });
    assert.equal(msg.statusCode, 503);
    assert.equal(msg.json().error, 'llm_not_configured');

    // No message was persisted (failed user message is rolled back).
    const thread = await app.inject({ method: 'GET', url: `/api/ai-chat/threads/${id}`, headers: h });
    assert.equal(thread.statusCode, 200);
    assert.equal((thread.json() as any).messages.length, 0);
    assert.equal((thread.json() as any).thread.title, 'New chat');

    // Quota was released: /me shows zero ai_tokens used today.
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: h });
    assert.equal(me.statusCode, 200);
    const quotas = (me.json() as any).quotas;
    assert.equal(quotas.ai_tokens_in.used, 0);
    assert.equal(quotas.ai_tokens_out.used, 0);
  });

  test('burst limiter: 31 rapid messages in a minute → 429 rate_limited', async () => {
    const h = await authed();
    const created = await app.inject({ method: 'POST', url: '/api/ai-chat/threads', headers: h, payload: {} });
    const id = (created.json() as any).thread.id;
    let limited = 0;
    for (let i = 0; i < 31; i++) {
      const r = await app.inject({
        method: 'POST', url: `/api/ai-chat/threads/${id}/messages`,
        headers: h, payload: { content: `burst ${i}` },
      });
      if (r.statusCode === 429 && (r.json() as any).error === 'rate_limited') limited++;
    }
    assert.ok(limited >= 1, 'expected at least one 429 from the burst limiter');
  });
});

describe('quota service', () => {
  before(async () => { await getApp(); });
  beforeEach(async () => { await truncateAll(); });

  test('reserve → release leaves zero usage; over-limit reserve is rejected', async () => {
    const { db } = await import('../db');
    const { reserveQuota, releaseQuota, readQuotas } = await import('../services/quota');
    const { getPlan } = await import('../services/plans');
    const user = await createUser('quotatest@example.com');
    const plan = await getPlan('personal-max-quality');

    const ok = await reserveQuota(user.id, plan, { images: 2 });
    assert.equal(ok.ok, true);

    const big = await reserveQuota(user.id, plan, { images: 10_000_000 });
    assert.equal(big.ok, false);
    assert.equal(big.field, 'images');

    await releaseQuota(user.id, { images: 2 });
    const q = await readQuotas(user.id, plan);
    assert.equal(q.images.used, 0);

    // Releasing more than reserved never goes negative.
    await releaseQuota(user.id, { images: 5 });
    const q2 = await readQuotas(user.id, plan);
    assert.equal(q2.images.used, 0);
    await db.deleteFrom('users').where('id', '=', user.id).execute();
  });
});

after(async () => { await closeTestEnv(); });
