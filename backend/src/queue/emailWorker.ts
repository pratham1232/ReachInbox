import { DelayedError, UnrecoverableError, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { createBullMQConnection, redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { senders } from '../db/schema.js';
import type { EmailJobData } from '../types/index.js';
import { EMAIL_QUEUE_NAME } from './emailQueue.js';
import {
  claimEmailForProcessing,
  markEmailFailed,
  markEmailSent,
  releaseEmailClaimForDelay,
  sendEmailViaSmtp,
} from '../services/email.js';
import {
  acquireHourlyRateLimit,
  acquireSenderDelayLock,
  computeRescheduleTimestampMs,
  getDeferredCountForWindow,
} from '../services/rateLimiter.js';
import { notifyRateLimitHit } from '../services/slack.js';
import { updateEmailDocStatus } from '../services/search.js';
import { logger } from '../utils/logger.js';

function isPermanentSmtpError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { responseCode?: number }).responseCode;
  if (typeof code === 'number' && code >= 500 && code < 600) {
    return true;
  }
  return false;
}

export async function processEmailJob(
  job: Job<EmailJobData>,
  token?: string,
): Promise<{ status: string; messageId?: string }> {
  const { emailId } = job.data;

  // Idempotency Layer 2: atomic DB claim
  const claimed = await claimEmailForProcessing(emailId);
  if (!claimed) {
    logger.info('Skipping email job: already claimed, sent, or missing', {
      emailId,
      jobId: job.id,
    });
    return { status: 'skipped' };
  }

  const [sender] = await db
    .select()
    .from(senders)
    .where(eq(senders.id, claimed.senderId));

  if (!sender) {
    const failed = await markEmailFailed({
      emailId,
      reason: 'Sender account not found',
    });
    if (failed) await updateEmailDocStatus(failed);
    throw new UnrecoverableError('Sender account not found');
  }

  const effectiveMinDelayMs =
    claimed.delayBetweenEmailsMs ?? env.MIN_DELAY_BETWEEN_EMAILS_MS;

  // 1. Per-sender minimum delay lock (Redis SET NX PX)
  const delayLock = await acquireSenderDelayLock(
    redis,
    sender.id,
    effectiveMinDelayMs,
  );
  if (!delayLock.acquired) {
    const delayUntil = Date.now() + delayLock.remainingMs;
    await releaseEmailClaimForDelay(emailId);
    await job.moveToDelayed(delayUntil, token);
    throw new DelayedError();
  }

  // 2. Atomic hourly rate limit (Redis Lua INCR + EXPIRE)
  const effectiveHourlyLimit =
    claimed.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER;
  const rateCheck = await acquireHourlyRateLimit(redis, {
    senderId: sender.id,
    senderHourlyLimit: effectiveHourlyLimit,
  });

  if (!rateCheck.allowed) {
    const targetTimestampMs = computeRescheduleTimestampMs({
      nextHourStartMs: rateCheck.nextHourStartMs,
      sequenceIndex: claimed.sequenceIndex,
      minDelayMs: effectiveMinDelayMs,
      hourlyLimit: effectiveHourlyLimit,
    });

    await releaseEmailClaimForDelay(emailId, new Date(targetTimestampMs));
    const deferredCount = await getDeferredCountForWindow(
      redis,
      sender.id,
      rateCheck.hourWindow,
    );

    await notifyRateLimitHit({
      userId: claimed.userId,
      senderId: sender.id,
      senderEmail: sender.email,
      limit: rateCheck.limit,
      hourWindow: rateCheck.hourWindow,
      deferredCount,
    });

    logger.info('Rate limit reached; deferring email to next hour window', {
      emailId,
      senderId: sender.id,
      hourWindow: rateCheck.hourWindow,
      targetTime: new Date(targetTimestampMs).toISOString(),
      deferredCount,
    });

    await job.moveToDelayed(targetTimestampMs, token);
    throw new DelayedError();
  }

  // 3. Send email via Ethereal SMTP (or DRY_RUN)
  try {
    const result = await sendEmailViaSmtp(claimed, sender);
    const updated = await markEmailSent({
      emailId,
      messageId: result.messageId,
      previewUrl: result.previewUrl,
      sentAt: new Date(),
    });
    if (updated) {
      await updateEmailDocStatus(updated);
    }

    logger.info('Email sent successfully', {
      emailId,
      recipient: claimed.recipient,
      messageId: result.messageId,
    });

    return { status: 'sent', messageId: result.messageId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const maxAttempts = job.opts.attempts ?? 5;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

    if (isPermanentSmtpError(err) || isFinalAttempt) {
      const failed = await markEmailFailed({
        emailId,
        reason: errMsg,
      });
      if (failed) {
        await updateEmailDocStatus(failed);
      }
      logger.error('Email permanently failed', {
        emailId,
        attemptsMade: job.attemptsMade + 1,
        error: errMsg,
      });
      if (isPermanentSmtpError(err)) {
        throw new UnrecoverableError(errMsg);
      }
      throw err;
    }

    // Transient error with retries remaining: release claim back to 'scheduled' so retry can claim it
    await releaseEmailClaimForDelay(emailId);
    logger.warn('Transient SMTP error; scheduling retry', {
      emailId,
      attempt: job.attemptsMade + 1,
      error: errMsg,
    });
    throw err;
  }
}

export function startEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job, token) => processEmailJob(job, token),
    {
      connection: createBullMQConnection(),
      concurrency: env.WORKER_CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    if (err instanceof DelayedError) return;
    logger.error('Worker job failed', {
      jobId: job?.id,
      emailId: job?.data?.emailId,
      error: err.message,
    });
  });

  worker.on('error', (err) => {
    logger.error('Worker error', { error: err.message });
  });

  logger.info('Email worker started', {
    concurrency: env.WORKER_CONCURRENCY,
    minDelayMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
    dryRun: env.DRY_RUN,
  });

  return worker;
}
