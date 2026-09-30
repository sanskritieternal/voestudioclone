import type { FastifyInstance } from 'fastify';
import { spendTotals, spendByProvider, spendByCapability, spendByTool, spendDaily } from '../services/cost';

/**
 * Spend dashboard (R2, personal use). Replaces the commercial Billing page:
 * no invoices or gateways — just honest cost metering of provider usage so
 * vaibhav can see which provider/transport is cheapest per video.
 * Costs are USD estimates from provider list prices, not bills.
 */
export default async function spendRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/summary', async (req) => {
    const days = clampDays((req.query as any)?.days);
    const [totals, byProvider, byCapability, byTool] = await Promise.all([
      spendTotals(req.user.id, days),
      spendByProvider(req.user.id, days),
      spendByCapability(req.user.id, days),
      spendByTool(req.user.id, days),
    ]);
    return { days, totals, by_provider: byProvider, by_capability: byCapability, by_tool: byTool, currency: 'USD', note: 'estimates from provider list prices, not bills' };
  });

  app.get('/daily', async (req) => {
    const days = clampDays((req.query as any)?.days);
    return { days, series: await spendDaily(req.user.id, days), currency: 'USD' };
  });
}

function clampDays(raw: unknown): number {
  const n = parseInt(String(raw ?? '30'), 10);
  if (Number.isNaN(n)) return 30;
  return Math.min(365, Math.max(1, n));
}
