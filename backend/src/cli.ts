import { db, closeDb } from './db';
import { hashPassword } from './services/auth';

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
  } else {
    console.error(`unknown command "${cmd}". available: create-user`);
    process.exit(1);
  }

  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
