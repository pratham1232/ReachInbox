import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { emails } from '../db/schema.js';
import { env } from '../config/env.js';
import { resetStaleProcessingEmails } from '../services/email.js';
import { emailQueue, enqueueEmailJobsBulk } from './emailQueue.js';
import { logger } from '../utils/logger.js';

/**
 * Boot-time persistence reconciliation:
 * 1. Reset stale 'processing' rows (no messageId, older than threshold) back to 'scheduled'.
 * 2. Find all DB rows with status='scheduled' that have no corresponding BullMQ job,
 *    and re-enqueue them using their DB ID as jobId.
 */
export async function reconcileScheduledEmails(): Promise<{
  staleResetCount: number;
  reEnqueuedCount: number;
}> {
  const staleResetCount = await resetStaleProcessingEmails(
    env.STALE_PROCESSING_THRESHOLD_MS,
  );

  const scheduledRows = await db
    .select()
    .from(emails)
    .where(eq(emails.status, 'scheduled'));

  const missingJobs: Array<{
    emailId: string;
    data: {
      emailId: string;
      userId: string;
      senderId: string;
      sequenceIndex: number;
      hourlyLimit: number | null;
      delayBetweenEmailsMs: number | null;
    };
    scheduledAt: Date;
  }> = [];

  for (const row of scheduledRows) {
    const existingJob = await emailQueue.getJob(row.id);
    let needsEnqueue = !existingJob;
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === 'failed') {
        await existingJob.remove();
        needsEnqueue = true;
      }
    }
    if (needsEnqueue) {
      missingJobs.push({
        emailId: row.id,
        data: {
          emailId: row.id,
          userId: row.userId,
          senderId: row.senderId,
          sequenceIndex: row.sequenceIndex,
          hourlyLimit: row.hourlyLimit,
          delayBetweenEmailsMs: row.delayBetweenEmailsMs,
        },
        scheduledAt: row.scheduledAt,
      });
    }
  }

  if (missingJobs.length > 0) {
    await enqueueEmailJobsBulk(missingJobs);
  }

  logger.info('Boot reconciliation completed', {
    staleResetCount,
    totalScheduledInDb: scheduledRows.length,
    reEnqueuedCount: missingJobs.length,
  });

  return {
    staleResetCount,
    reEnqueuedCount: missingJobs.length,
  };
}
