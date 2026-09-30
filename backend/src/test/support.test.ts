import { before, after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getApp, truncateAll, createUser, loginToken, authHeaders, closeTestEnv } from './setup';

describe('support tickets', () => {
  let app: Awaited<ReturnType<typeof getApp>>;
  before(async () => { app = await getApp(); });
  after(async () => { await closeTestEnv(); });
  beforeEach(async () => { await truncateAll(); });

  async function authed() {
    await createUser('supporttest@example.com');
    return authHeaders(await loginToken(app, 'supporttest@example.com'));
  }

  test('full lifecycle: create → reply → status → view → delete', async () => {
    const h = await authed();
    const created = await app.inject({
      method: 'POST', url: '/api/support/tickets', headers: h,
      payload: { subject: 'Export is stuck', body: 'My video export never finishes.' },
    });
    assert.equal(created.statusCode, 200);
    const ticket = (created.json() as any).ticket as any;
    assert.ok(ticket.id);
    assert.equal(ticket.status, 'open');

    const replied = await app.inject({
      method: 'POST', url: `/api/support/tickets/${ticket.id}/replies`, headers: h,
      payload: { body: 'Any update?' },
    });
    assert.equal(replied.statusCode, 200);

    const patched = await app.inject({
      method: 'PATCH', url: `/api/support/tickets/${ticket.id}`, headers: h,
      payload: { status: 'in_progress' },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal((patched.json() as any).ticket.status, 'in_progress');

    const filtered = await app.inject({
      method: 'GET', url: '/api/support/tickets?status=in_progress', headers: h,
    });
    assert.equal((filtered.json() as any).tickets.length, 1);
    const filteredOpen = await app.inject({
      method: 'GET', url: '/api/support/tickets?status=open', headers: h,
    });
    assert.equal((filteredOpen.json() as any).tickets.length, 0);

    const viewed = await app.inject({
      method: 'GET', url: `/api/support/tickets/${ticket.id}`, headers: h,
    });
    assert.equal(viewed.statusCode, 200);
    assert.equal((viewed.json() as any).replies.length, 1);

    const deleted = await app.inject({
      method: 'DELETE', url: `/api/support/tickets/${ticket.id}`, headers: h,
    });
    assert.equal(deleted.statusCode, 200);
    const gone = await app.inject({
      method: 'GET', url: `/api/support/tickets/${ticket.id}`, headers: h,
    });
    assert.equal(gone.statusCode, 404);
  });

  test('invalid status transition is rejected', async () => {
    const h = await authed();
    const created = await app.inject({
      method: 'POST', url: '/api/support/tickets', headers: h,
      payload: { subject: 'X', body: 'Y' },
    });
    const id = (created.json() as any).ticket.id;
    const bad = await app.inject({
      method: 'PATCH', url: `/api/support/tickets/${id}`, headers: h,
      payload: { status: 'teleported' },
    });
    assert.equal(bad.statusCode, 400);
  });

  test('tickets are isolated per user', async () => {
    const h1 = await authed();
    await createUser('supportother@example.com');
    const h2 = authHeaders(await loginToken(app, 'supportother@example.com'));
    const created = await app.inject({
      method: 'POST', url: '/api/support/tickets', headers: h1,
      payload: { subject: 'Private', body: 'mine' },
    });
    const id = (created.json() as any).ticket.id;
    const peek = await app.inject({ method: 'GET', url: `/api/support/tickets/${id}`, headers: h2 });
    assert.equal(peek.statusCode, 404);
    const list = await app.inject({ method: 'GET', url: '/api/support/tickets', headers: h2 });
    assert.equal((list.json() as any).tickets.length, 0);
  });
});
