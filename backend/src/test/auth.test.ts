import { before, after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getApp, truncateAll, createUser, loginToken, authHeaders, closeTestEnv } from './setup';

describe('auth', () => {
  let app: Awaited<ReturnType<typeof getApp>>;
  before(async () => { app = await getApp(); });
  after(async () => { await closeTestEnv(); });
  beforeEach(async () => { await truncateAll(); });

  test('login succeeds and /me returns the user', async () => {
    await createUser('authtest@example.com');
    const token = await loginToken(app, 'authtest@example.com');
    assert.ok(token.length > 20);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeaders(token) });
    assert.equal(me.statusCode, 200);
    assert.equal((me.json() as any).user.email, 'authtest@example.com');
  });

  test('login rejects a wrong password', async () => {
    await createUser('authwrong@example.com');
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'authwrong@example.com', password: 'nope-wrong' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error, 'invalid_credentials');
  });

  test('protected routes reject a missing token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    assert.equal(res.statusCode, 401);
  });

  test('refresh token rotation issues a new access token', async () => {
    await createUser('authrefresh@example.com');
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'authrefresh@example.com', password: 'test-password-123' },
    });
    const { refresh_token } = login.json();
    assert.ok(refresh_token);
    const rotated = await app.inject({
      method: 'POST', url: '/api/auth/refresh', payload: { refresh_token },
    });
    assert.equal(rotated.statusCode, 200);
    assert.ok((rotated.json() as any).token);
    // Old refresh token is revoked after rotation.
    const reuse = await app.inject({
      method: 'POST', url: '/api/auth/refresh', payload: { refresh_token },
    });
    assert.equal(reuse.statusCode, 401);
  });

  test('logout revokes the refresh token', async () => {
    await createUser('authlogout@example.com');
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'authlogout@example.com', password: 'test-password-123' },
    });
    const { refresh_token } = login.json();
    const out = await app.inject({
      method: 'POST', url: '/api/auth/logout', payload: { refresh_token },
    });
    assert.equal(out.statusCode, 200);
    const reuse = await app.inject({
      method: 'POST', url: '/api/auth/refresh', payload: { refresh_token },
    });
    assert.equal(reuse.statusCode, 401);
  });
});
