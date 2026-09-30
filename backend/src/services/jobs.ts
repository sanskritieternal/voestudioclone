import { db } from '../db';
import { queues, queueForCapability, type QueueName } from '../queues';
import type { Capability } from './providers';
import type { QuotaUsage } from './quota';

export interface CreateJobOpts {
  userId: string;
  projectId?: string | null;
  tool: string;
  kind: string;
  capability: Capability;
  params: Record<string, unknown>;
  quotaReserved?: QuotaUsage;
  idempotencyKey?: string;
  priority?: number;
}

export async function createJob(opts: CreateJobOpts) {
  if (opts.idempotencyKey) {
    const existing = await db
      .selectFrom('jobs')
      .selectAll()
      .where('idempotency_key', '=', opts.idempotencyKey)
      .where('user_id', '=', opts.userId)
      .executeTakeFirst();
    if (existing) return { job: existing, deduped: true };
  }

  let row;
  try {
    row = await db
      .insertInto('jobs')
      .values({
        user_id: opts.userId,
        project_id: opts.projectId ?? null,
        tool: opts.tool,
        kind: opts.kind,
        capability: opts.capability,
        params: opts.params,
        quota_reserved: (opts.quotaReserved as Record<string, number> | null) ?? null,
        idempotency_key: opts.idempotencyKey ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (err: any) {
    if (err?.code === '23505' && opts.idempotencyKey) {
      const existing = await db
        .selectFrom('jobs')
        .selectAll()
        .where('idempotency_key', '=', opts.idempotencyKey)
        .where('user_id', '=', opts.userId)
        .executeTakeFirstOrThrow();
      return { job: existing, deduped: true };
    }
    throw err;
  }

  const queue: QueueName = queueForCapability(opts.capability);
  await queues[queue].add(opts.kind, { jobId: row.id }, { jobId: row.id, priority: opts.priority ?? 0 });
  await db.updateTable('jobs').set({ bullmq_job_id: row.id }).where('id', '=', row.id).execute();

  return { job: row, deduped: false };
}

export async function findJobByIdempotency(userId: string, key: string) {
  return db
    .selectFrom('jobs')
    .selectAll()
    .where('idempotency_key', '=', key)
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

export function jobShape(row: any) {
  return {
    id: row.id,
    tool: row.tool,
    kind: row.kind,
    status: row.status,
    progress: row.progress,
    params: row.params,
    result: row.result,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
