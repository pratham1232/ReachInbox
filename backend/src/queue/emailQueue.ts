import { Queue } from 'bullmq';
import { createBullMQConnection } from '../config/redis.js';
import type { EmailJobData } from '../types/index.js';

export const EMAIL_QUEUE_NAME = 'email-send';

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: createBullMQConnection(),
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      age: 24 * 3600,
      count: 5000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
    },
  },
});

export async function enqueueEmailJob(params: {
  emailId: string;
  data: EmailJobData;
  scheduledAt: Date;
}): Promise<void> {
  const delayMs = Math.max(0, params.scheduledAt.getTime() - Date.now());
  await emailQueue.add('send-email', params.data, {
    jobId: params.emailId, // Idempotency Layer 1: DB row ID is the BullMQ jobId
    delay: delayMs,
  });
}

export async function enqueueEmailJobsBulk(
  jobs: Array<{ emailId: string; data: EmailJobData; scheduledAt: Date }>,
): Promise<void> {
  const now = Date.now();
  const chunkSize = 500;
  for (let i = 0; i < jobs.length; i += chunkSize) {
    const chunk = jobs.slice(i, i + chunkSize).map((item) => ({
      name: 'send-email',
      data: item.data,
      opts: {
        jobId: item.emailId,
        delay: Math.max(0, item.scheduledAt.getTime() - now),
      },
    }));
    await emailQueue.addBulk(chunk);
  }
}

export async function closeEmailQueue(): Promise<void> {
  await emailQueue.close();
}
