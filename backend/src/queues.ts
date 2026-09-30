import { Queue } from 'bullmq';
import { createRedis } from './redis';

export const QUEUE_NAMES = ['video', 'image', 'tts', 'analysis'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/** Queue name matches capability 1:1. */
export function queueForCapability(capability: string): QueueName {
  if ((QUEUE_NAMES as readonly string[]).includes(capability)) return capability as QueueName;
  return 'analysis';
}

const connection = createRedis();

export const queues: Record<QueueName, Queue> = {
  video: new Queue('video', { connection }),
  image: new Queue('image', { connection }),
  tts: new Queue('tts', { connection }),
  analysis: new Queue('analysis', { connection }),
};

export async function closeQueues(): Promise<void> {
  for (const q of Object.values(queues)) await q.close();
  await connection.quit();
}
