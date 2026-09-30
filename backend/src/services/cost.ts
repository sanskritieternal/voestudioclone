import { db } from '../db';
import { sql } from 'kysely';

/** Cost metering (blueprint §5.4): every provider call is logged for the Spend dashboard. */
export async function logCost(opts: {
  userId: string | null;
  jobId: string | null;
  provider: string;
  capability: string;
  tool?: string | null;
  units: number;
  costEstimate: number | null;
}): Promise<void> {
  await db
    .insertInto('provider_cost_log')
    .values({
      user_id: opts.userId,
      job_id: opts.jobId,
      provider: opts.provider,
      capability: opts.capability,
      tool: opts.tool ?? null,
      units: opts.units,
      cost_estimate: opts.costEstimate,
    })
    .execute();
}

export async function spendSummary(userId: string, days: number): Promise<
  Array<{ provider: string; capability: string; units: string; cost: string | null }>
> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const rows = await db
    .selectFrom('provider_cost_log')
    .select(['provider', 'capability'])
    .select((eb) => [
      eb.fn.sum('units').as('units'),
      eb.fn.sum('cost_estimate').as('cost'),
    ])
    .where('user_id', '=', userId)
    .where('created_at', '>=', since)
    .groupBy(['provider', 'capability'])
    .execute();
  return rows.map((r) => ({ provider: r.provider, capability: r.capability, units: String(r.units), cost: r.cost === null ? null : String(r.cost) }));
}

interface SpendRow {
  key: string;
  calls: number;
  units: string;
  cost: string | null;
}

async function breakdown(userId: string, days: number, by: 'provider' | 'capability' | 'tool'): Promise<SpendRow[]> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const col = by === 'tool' ? 'tool' : by;
  const rows = await db
    .selectFrom('provider_cost_log')
    .select(col as any)
    .select((eb) => [
      eb.fn.countAll().as('calls'),
      eb.fn.sum('units').as('units'),
      eb.fn.sum('cost_estimate').as('cost'),
    ])
    .where('user_id', '=', userId)
    .where('created_at', '>=', since)
    .groupBy(col as any)
    .orderBy('cost', 'desc')
    .execute();
  return rows.map((r: any) => ({
    key: r[col] ?? '(unknown)',
    calls: Number(r.calls),
    units: String(r.units),
    cost: r.cost === null ? null : String(r.cost),
  }));
}

export async function spendByProvider(userId: string, days: number): Promise<SpendRow[]> {
  return breakdown(userId, days, 'provider');
}

export async function spendByCapability(userId: string, days: number): Promise<SpendRow[]> {
  return breakdown(userId, days, 'capability');
}

export async function spendByTool(userId: string, days: number): Promise<SpendRow[]> {
  return breakdown(userId, days, 'tool');
}

export async function spendTotals(userId: string, days: number): Promise<{ calls: number; units: string; cost: string | null }> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const r = await db
    .selectFrom('provider_cost_log')
    .select((eb) => [
      eb.fn.countAll().as('calls'),
      eb.fn.sum('units').as('units'),
      eb.fn.sum('cost_estimate').as('cost'),
    ])
    .where('user_id', '=', userId)
    .where('created_at', '>=', since)
    .executeTakeFirstOrThrow();
  return { calls: Number((r as any).calls), units: String((r as any).units), cost: (r as any).cost === null ? null : String((r as any).cost) };
}

export async function spendDaily(
  userId: string,
  days: number,
): Promise<Array<{ day: string; calls: number; units: string; cost: string | null }>> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const rows = await db
    .selectFrom('provider_cost_log')
    .select(sql<Date>`date_trunc('day', created_at)`.as('day'))
    .select((eb) => [
      eb.fn.countAll().as('calls'),
      eb.fn.sum('units').as('units'),
      eb.fn.sum('cost_estimate').as('cost'),
    ])
    .where('user_id', '=', userId)
    .where('created_at', '>=', since)
    .groupBy('day')
    .orderBy('day', 'asc')
    .execute();
  return rows.map((r: any) => ({
    day: new Date(r.day).toISOString().slice(0, 10),
    calls: Number(r.calls),
    units: String(r.units),
    cost: r.cost === null ? null : String(r.cost),
  }));
}

/** Per-provider unit cost (USD) from the registry, for quota/spend estimates. */
export async function providerUnitCost(provider: string): Promise<number> {
  const row = await db
    .selectFrom('provider_registry')
    .select('cost_per_unit')
    .where('name', '=', provider)
    .orderBy('priority', 'asc')
    .executeTakeFirst();
  const v = row?.cost_per_unit;
  return v === null || v === undefined ? 0 : Number(v);
}
