import type { FastifyInstance } from 'fastify';
import { db } from '../db';

export default async function voiceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const q = req.query as { language?: string; gender?: string; country?: string; q?: string; page?: string; pageSize?: string };
    const page = Math.max(1, parseInt(q.page ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '50', 10)));
    let sel = db.selectFrom('voices').selectAll();
    if (q.language) sel = sel.where('language', '=', q.language);
    if (q.gender) sel = sel.where('gender', '=', q.gender);
    if (q.country) sel = sel.where('country', '=', q.country);
    if (q.q) sel = sel.where((eb) => eb.or([eb('name', 'ilike', `%${q.q}%`), eb('provider_voice_id', 'ilike', `%${q.q}%`)]));
    const total = await sel.clearSelect().select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow();
    const rows = await sel.clearSelect().selectAll().orderBy('name').limit(pageSize).offset((page - 1) * pageSize).execute();
    return {
      voices: rows.map((v) => ({ id: v.id, provider: v.provider, voice_id: v.provider_voice_id, name: v.name, gender: v.gender, language: v.language, country: v.country, preview_url: v.preview_url })),
      total: Number((total as any).n), page, pageSize,
    };
  });

  app.get('/languages', async () => {
    const rows = await db
      .selectFrom('voices')
      .select(['language'])
      .select((eb) => eb.fn.countAll().as('voice_count'))
      .where('language', 'is not', null)
      .groupBy('language')
      .orderBy('language')
      .execute();
    return { languages: rows.map((r) => ({ code: r.language, name: r.language, voice_count: Number((r as any).voice_count) })) };
  });
}
