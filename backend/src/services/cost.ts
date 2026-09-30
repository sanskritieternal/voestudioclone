import { db } from '../db';

/** Cost metering (blueprint §5.4): every provider call is logged for the Spend dashboard. */
export async function logCost(opts: {
  userId: string | null;
  jobId: string | null;
  provider: string;
  capability: string;
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
