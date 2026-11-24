import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { emails, senders, type Email, type Sender } from '../db/schema.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const transporterCache = new Map<string, Transporter>();

export async function createEtherealSender(params: {
  userId: string;
  name?: string;
}): Promise<Sender> {
  const testAccount = await nodemailer.createTestAccount();

  const [created] = await db
    .insert(senders)
    .values({
      userId: params.userId,
      name: params.name?.trim() || `Ethereal (${testAccount.user.split('@')[0]})`,
      email: testAccount.user,
      smtpHost: testAccount.smtp.host,
      smtpPort: testAccount.smtp.port,
      smtpSecure: testAccount.smtp.secure,
      smtpUser: testAccount.user,
      smtpPassEncrypted: encryptSecret(testAccount.pass),
    })
    .returning();

  logger.info('Created Ethereal sender account', {
    senderId: created.id,
    email: created.email,
    userId: params.userId,
  });

  return created;
}

export async function createDryRunSender(params: {
  userId: string;
  name?: string;
  email?: string;
}): Promise<Sender> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const [created] = await db
    .insert(senders)
    .values({
      userId: params.userId,
      name: params.name || `Load Test Sender (${suffix})`,
      email: params.email || `sender-${suffix}@ethereal.email`,
      smtpHost: 'smtp.ethereal.email',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: `sender-${suffix}@ethereal.email`,
      smtpPassEncrypted: encryptSecret('dry-run-pass'),
    })
    .returning();

  return created;
}

function getTransporter(sender: Sender): Transporter {
  const cached = transporterCache.get(sender.id);
  if (cached) {
    return cached;
  }

  const pass = decryptSecret(sender.smtpPassEncrypted);
  const transporter = nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpSecure,
    auth: {
      user: sender.smtpUser,
      pass,
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });

  transporterCache.set(sender.id, transporter);
  return transporter;
}

/**
 * Idempotency Layer 2:
 * Atomically claim the email row only if it is currently 'scheduled'.
 * Returns the claimed Email row, or null if another worker already claimed/sent it.
 */
export async function claimEmailForProcessing(emailId: string): Promise<Email | null> {
  const claimed = await db
    .update(emails)
    .set({
      status: 'processing',
      processingStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(emails.id, emailId), eq(emails.status, 'scheduled')))
    .returning();

  return claimed[0] ?? null;
}

/**
 * Releases a claimed email back to 'scheduled' when deferred due to rate limit or min delay,
 * so it can be cleanly claimed again when the delayed job fires.
 */
export async function releaseEmailClaimForDelay(
  emailId: string,
  nextScheduledAt?: Date,
): Promise<void> {
  await db
    .update(emails)
    .set({
      status: 'scheduled',
      processingStartedAt: null,
      ...(nextScheduledAt ? { scheduledAt: nextScheduledAt } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(emails.id, emailId), eq(emails.status, 'processing')));
}

export async function markEmailSent(params: {
  emailId: string;
  messageId: string;
  previewUrl: string | null;
  sentAt: Date;
}): Promise<Email | null> {
  const updated = await db
    .update(emails)
    .set({
      status: 'sent',
      sentAt: params.sentAt,
      messageId: params.messageId,
      previewUrl: params.previewUrl,
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(emails.id, params.emailId))
    .returning();

  return updated[0] ?? null;
}

export async function markEmailFailed(params: {
  emailId: string;
  reason: string;
}): Promise<Email | null> {
  const updated = await db
    .update(emails)
    .set({
      status: 'failed',
      failureReason: params.reason.slice(0, 1000),
      updatedAt: new Date(),
    })
    .where(eq(emails.id, params.emailId))
    .returning();

  return updated[0] ?? null;
}

export interface SendResult {
  messageId: string;
  previewUrl: string | null;
}

export async function sendEmailViaSmtp(email: Email, sender: Sender): Promise<SendResult> {
  if (env.DRY_RUN) {
    return {
      messageId: `<dry-run-${email.id}@reachinbox.local>`,
      previewUrl: `https://ethereal.email/message/dry-run-${email.id}`,
    };
  }

  const transporter = getTransporter(sender);
  const info = await transporter.sendMail({
    from: `"${sender.name}" <${sender.email}>`,
    to: email.recipient,
    subject: email.subject,
    text: email.body,
    html: `<div style="font-family: sans-serif; line-height: 1.5;">${email.body.replace(/\n/g, '<br/>')}</div>`,
  });

  const preview = nodemailer.getTestMessageUrl(info);
  return {
    messageId: info.messageId || `<${email.id}@ethereal.email>`,
    previewUrl: typeof preview === 'string' ? preview : null,
  };
}

export async function resetStaleProcessingEmails(thresholdMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - thresholdMs);
  const reset = await db
    .update(emails)
    .set({
      status: 'scheduled',
      processingStartedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emails.status, 'processing'),
        sql`${emails.messageId} IS NULL`,
        sql`${emails.processingStartedAt} < ${cutoff}`,
      ),
    )
    .returning({ id: emails.id });

  return reset.length;
}
