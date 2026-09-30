import { db, closeDb } from './db';
import { hashPassword } from './services/auth';
import { syncElevenLabsVoices } from './services/providers/elevenlabs';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (cmd === 'create-user') {
    const email = (args['email'] ?? '').toLowerCase();
    const password = args['password'] ?? '';
    const plan = args['plan'] ?? 'personal-max-quality';
    const name = args['name'] ?? email.split('@')[0];
    if (!email || !password) {
      console.error('usage: cli create-user --email <email> --password <pw> [--plan personal-max-quality] [--name <name>]');
      process.exit(1);
    }
    const planRow = await db.selectFrom('plans').select('id').where('id', '=', plan).executeTakeFirst();
    if (!planRow) {
      console.error(`unknown plan "${plan}"`);
      process.exit(1);
    }
    const row = await db
      .insertInto('users')
      .values({ email, password_hash: await hashPassword(password), name, plan_id: plan, email_verified: true })
      .returning(['id', 'email', 'plan_id'])
      .executeTakeFirstOrThrow();
    console.log(`created user ${row.email} (id=${row.id}, plan=${row.plan_id})`);
  } else if (cmd === 'list-users') {
    // R6 admin: table of users with plan + today's quota usage.
    const { getPlan } = await import('./services/plans');
    const { readQuotas } = await import('./services/quota');
    const users = await db.selectFrom('users').select(['id', 'email', 'name', 'plan_id', 'status', 'created_at']).orderBy('created_at').execute();
    for (const u of users) {
      const plan = await getPlan(u.plan_id);
      const q = await readQuotas(u.id, plan);
      const used = Object.entries(q).filter(([, v]: any) => v && typeof v === 'object' && 'used' in v).map(([k, v]: any) => `${k}:${v.used}/${v.limit}`).join(' ');
      console.log(`${u.email} [${u.status}] plan=${u.plan_id} ${used}`);
    }
    if (users.length === 0) console.log('(no users)');
  } else if (cmd === 'set-plan') {
    // R6 admin: switch a user's routing profile.
    const email = (args['email'] ?? '').toLowerCase();
    const plan = args['plan'] ?? '';
    if (!email || !plan) {
      console.error('usage: cli set-plan --email <email> --plan <plan-id>');
      process.exit(1);
    }
    const planRow = await db.selectFrom('plans').select('id').where('id', '=', plan).executeTakeFirst();
    if (!planRow) {
      console.error(`unknown plan "${plan}"`);
      process.exit(1);
    }
    const target = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
    if (!target) {
      console.error(`no user with email "${email}"`);
      process.exit(1);
    }
    await db.updateTable('users').set({ plan_id: plan }).where('id', '=', target.id).execute();
    console.log(`set ${email} plan=${plan}`);
  } else if (cmd === 'user-info') {
    // R6 admin: one user's detail + today's quota usage.
    const email = (args['email'] ?? '').toLowerCase();
    if (!email) {
      console.error('usage: cli user-info --email <email>');
      process.exit(1);
    }
    const { getPlan } = await import('./services/plans');
    const { readQuotas } = await import('./services/quota');
    const u = await db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst();
    if (!u) {
      console.error(`no user with email "${email}"`);
      process.exit(1);
    }
    const plan = await getPlan(u.plan_id);
    const q = await readQuotas(u.id, plan);
    console.log(JSON.stringify({ id: u.id, email: u.email, name: u.name, plan_id: u.plan_id, status: u.status, created_at: u.created_at, quotas: q }, null, 2));
  } else if (cmd === 'sync-voices') {
    // Pull the ElevenLabs voice catalog into the voices table (powers GET /api/voices).
    try {
      const res = await syncElevenLabsVoices();
      console.log(`synced voices: fetched=${res.fetched} upserted=${res.upserted}`);
    } catch (err: any) {
      console.error(`sync-voices failed: ${err?.message ?? String(err)}`);
      if (err?.code === 'elevenlabs_not_configured') {
        console.error('hint: set ELEVENLABS_API_KEY in backend/.env to use the real catalog (stub voices stay until then).');
      }
      process.exit(1);
    }
  } else {
    console.error(`unknown command "${cmd}". available: create-user, list-users, set-plan, user-info, sync-voices`);
    process.exit(1);
  }

  await closeDb();
  const { redis } = await import('./redis');
  redis.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
