import type { FastifyInstance } from 'fastify';
import { db } from '../db';
import { config } from '../config';
import { hashPassword, newRefreshToken, hashToken, verifyPassword } from '../services/auth';
import { getPlan } from '../services/plans';
import { readQuotas } from '../services/quota';
import { rateLimit } from '../middleware/rateLimit';

const loginLimiter = rateLimit({ windowSec: 60, max: 10, key: (req) => `login:${req.ip}` });

function publicUser(u: any) {
  return { id: u.id, email: u.email, name: u.name, avatar_url: u.avatar_url, plan_id: u.plan_id, status: u.status };
}

const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 1 } },
  },
};

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/login', { preHandler: loginLimiter, schema: loginSchema }, async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };
    const user = await db.selectFrom('users').selectAll().where('email', '=', email.toLowerCase()).executeTakeFirst();
    if (!user || user.status !== 'active' || !(await verifyPassword(password, user.password_hash))) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    await db.updateTable('users').set({ last_login_at: new Date() }).where('id', '=', user.id).execute();

    const token = app.jwt.sign({ id: user.id, planId: user.plan_id }, { expiresIn: config.accessTtlSec });
    const { token: refreshToken, tokenHash } = newRefreshToken();
    await db
      .insertInto('refresh_tokens')
      .values({ user_id: user.id, token_hash: tokenHash, expires_at: new Date(Date.now() + config.refreshTtlDays * 86400_000) })
      .execute();

    return { token, refresh_token: refreshToken, user: publicUser(user) };
  });

  app.post(
    '/refresh',
    {
      schema: {
        body: {
          type: 'object',
          required: ['refresh_token'],
          properties: { refresh_token: { type: 'string' } },
        },
      },
    },
    async (req, reply) => {
    const { refresh_token } = req.body as { refresh_token: string };
    const row = await db
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('token_hash', '=', hashToken(refresh_token))
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (!row || row.expires_at < new Date()) return reply.code(401).send({ error: 'invalid_refresh_token' });

    // rotate: revoke the old one, issue a new pair
    await db.updateTable('refresh_tokens').set({ revoked_at: new Date() }).where('id', '=', row.id).execute();
    const user = await db.selectFrom('users').selectAll().where('id', '=', row.user_id).executeTakeFirst();
    if (!user || user.status !== 'active') return reply.code(401).send({ error: 'invalid_refresh_token' });

    const token = app.jwt.sign({ id: user.id, planId: user.plan_id }, { expiresIn: config.accessTtlSec });
    const { token: newRefresh, tokenHash } = newRefreshToken();
    await db
      .insertInto('refresh_tokens')
      .values({ user_id: user.id, token_hash: tokenHash, expires_at: new Date(Date.now() + config.refreshTtlDays * 86400_000) })
      .execute();
    return { token, refresh_token: newRefresh };
  });

  app.post('/logout', async (req) => {
    const { refresh_token } = (req.body ?? {}) as { refresh_token?: string };
    if (refresh_token) {
      await db.updateTable('refresh_tokens').set({ revoked_at: new Date() }).where('token_hash', '=', hashToken(refresh_token)).execute();
    }
    return { ok: true };
  });

  app.get('/me', { preHandler: [app.authenticate] }, async (req) => {
    const userId = req.user.id;
    const user = await db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirstOrThrow();
    const plan = await getPlan(user.plan_id);
    const quotas = await readQuotas(user.id, plan);
    return {
      user: publicUser(user),
      plan: { id: plan.id, slug: plan.slug, name: plan.name, limits: plan.limits, features: plan.features },
      quotas,
    };
  });

  // helper export for cli/tests
  void hashPassword;
}
