import { Worker, type Job } from 'bullmq';
import { createRedis } from './redis';
import { config } from './config';
import { db, closeDb } from './db';
import { QUEUE_NAMES, type QueueName } from './queues';
import { resolveProviders, type Capability, type NewArtifact } from './services/providers';
import { logCost } from './services/cost';
import { releaseQuota, reconcileUsage } from './services/quota';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface WorkerData {
  jobId: string;
}

async function updateProgress(jobId: string, progress: number): Promise<void> {
  await db.updateTable('jobs').set({ progress, updated_at: new Date() }).where('id', '=', jobId).execute();
}

async function completeJob(jobId: string, userId: string, providerName: string, artifacts: NewArtifact[], costEstimate: number | null): Promise<void> {
  const urlPrefix = `/artifacts/${userId}/${jobId}`;
  const urls: string[] = [];
  for (const a of artifacts) {
    const row = await db
      .insertInto('artifacts')
      .values({ job_id: jobId, user_id: userId, kind: a.kind, url: `${urlPrefix}/${a.fileName}`, prompt: a.prompt ?? null, meta: { ...(a.meta ?? {}), provider: providerName } })
      .returningAll()
      .executeTakeFirstOrThrow();
    urls.push(row.url);
  }
  await db
    .updateTable('jobs')
    .set({ status: 'completed', progress: 100, result: { artifacts: urls, provider: providerName }, updated_at: new Date() })
    .where('id', '=', jobId)
    .execute();
  const job = await db.selectFrom('jobs').select(['capability', 'quota_reserved']).where('id', '=', jobId).executeTakeFirstOrThrow();
  const units = Object.values((job.quota_reserved as Record<string, number> | null) ?? {}).reduce((s, v) => s + (v || 0), 0);
  await logCost({ userId, jobId, provider: providerName, capability: job.capability, units, costEstimate });
  await reconcileUsage(userId, job.quota_reserved as Record<string, number> | null);
}

async function failJob(jobId: string, userId: string, error: string): Promise<void> {
  const job = await db.selectFrom('jobs').select('quota_reserved').where('id', '=', jobId).executeTakeFirst();
  if (job?.quota_reserved) await releaseQuota(userId, job.quota_reserved as Record<string, number>);
  await db
    .updateTable('jobs')
    .set({ status: 'failed', error: error.slice(0, 2000), updated_at: new Date() })
    .where('id', '=', jobId)
    .execute();
}

async function processJob(bjob: Job<WorkerData>): Promise<void> {
  const { jobId } = bjob.data;
  const rec = await db.selectFrom('jobs').selectAll().where('id', '=', jobId).executeTakeFirst();
  if (!rec) throw new Error(`job row ${jobId} not found`);
  if (rec.status === 'cancelled') return;

  await db
    .updateTable('jobs')
    .set({ status: 'active', attempts: (rec.attempts ?? 0) + 1, updated_at: new Date() })
    .where('id', '=', jobId)
    .execute();

  const capability = rec.capability as Capability;
  const call = {
    capability,
    tool: rec.tool,
    params: (rec.params as Record<string, unknown>) ?? {},
    userId: rec.user_id,
    jobId: rec.id,
  };

  const providers = await resolveProviders(capability, rec.tool);
  let lastError = 'no provider available';
  for (const p of providers) {
    try {
      const handle = await p.submit(call);
      for (;;) {
        const res = await p.poll(handle, call);
        if (res.status === 'processing') {
          await updateProgress(jobId, res.progress);
          await bjob.updateProgress(res.progress);
          await sleep(2500);
          continue;
        }
        if (res.status === 'completed') {
          await completeJob(jobId, rec.user_id, p.name, res.artifacts, res.costEstimate ?? null);
          return;
        }
        throw new Error(res.error);
      }
    } catch (err: any) {
      lastError = err?.message ?? String(err);
    }
  }
  // chain exhausted — throw so BullMQ retries with backoff; final failure handled in 'failed' event
  throw new Error(lastError);
}

async function main(): Promise<void> {
  const workers: Worker[] = [];
  for (const name of QUEUE_NAMES) {
    const queueName = name as QueueName;
    const worker = new Worker<WorkerData>(queueName, (job) => processJob(job), {
      connection: createRedis(),
      concurrency: config.workerConcurrency,
    });
    worker.on('failed', async (job, err) => {
      if (!job) return;
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade >= maxAttempts) {
        const rec = await db.selectFrom('jobs').select('user_id').where('id', '=', (job.data as WorkerData).jobId).executeTakeFirst();
        await failJob((job.data as WorkerData).jobId, rec?.user_id ?? '', err.message);
      }
    });
    worker.on('error', (err) => console.error(`worker ${queueName} error:`, err));
    console.log(`worker listening on queue "${queueName}" (concurrency ${config.workerConcurrency})`);
    workers.push(worker);
  }

  const shutdown = async () => {
    console.log('shutting down workers…');
    for (const w of workers) await w.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('worker failed to start:', err);
  process.exit(1);
});
