import { Router } from 'express';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { emails, senders } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { enqueueEmailJobsBulk } from '../queue/emailQueue.js';
import { indexEmailDoc, searchEmailsInEs } from '../services/search.js';
import { env } from '../config/env.js';

const router = Router();
router.use(requireAuth);

const scheduleSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(300),
  body: z.string().trim().min(1, 'Body is required'),
  recipients: z
    .array(z.string().trim().email('Invalid email address'))
    .min(1, 'At least one valid recipient is required')
    .max(5000),
  startTime: z.string().datetime({ message: 'Valid ISO startTime is required' }),
  delayBetweenEmailsMs: z.coerce
    .number()
    .int()
    .min(0)
    .default(env.MIN_DELAY_BETWEEN_EMAILS_MS),
  hourlyLimit: z.coerce
    .number()
    .int()
    .positive()
    .default(env.MAX_EMAILS_PER_HOUR_PER_SENDER),
  senderId: z.string().uuid().optional(),
});

router.post('/schedule', async (req, res, next) => {
  try {
    const parsed = scheduleSchema.parse(req.body);
    const userId = req.user!.id;

    // Deduplicate recipients preserving order
    const uniqueRecipients = Array.from(
      new Set(parsed.recipients.map((r) => r.toLowerCase())),
    );

    const userSenders = await db
      .select()
      .from(senders)
      .where(eq(senders.userId, userId));

    if (userSenders.length === 0) {
      throw new AppError(
        400,
        'No sender account found. Please create an Ethereal sender first.',
      );
    }

    let chosenSenderId: string | null = null;
    if (parsed.senderId) {
      const match = userSenders.find((s) => s.id === parsed.senderId);
      if (!match) {
        throw new AppError(404, 'Selected sender not found');
      }
      chosenSenderId = match.id;
    }

    const startMs = new Date(parsed.startTime).getTime();

    const createdEmails = await db.transaction(async (tx) => {
      const valuesToInsert = uniqueRecipients.map((recipient, idx) => {
        const assignedSenderId =
          chosenSenderId ?? userSenders[idx % userSenders.length].id;
        const scheduledAt = new Date(startMs + idx * parsed.delayBetweenEmailsMs);

        return {
          userId,
          senderId: assignedSenderId,
          recipient,
          subject: parsed.subject,
          body: parsed.body,
          status: 'scheduled' as const,
          sequenceIndex: idx,
          hourlyLimit: parsed.hourlyLimit,
          delayBetweenEmailsMs: parsed.delayBetweenEmailsMs,
          scheduledAt,
        };
      });

      return tx.insert(emails).values(valuesToInsert).returning();
    });

    await enqueueEmailJobsBulk(
      createdEmails.map((row) => ({
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
      })),
    );

    // Non-fatal Elasticsearch indexing
    void Promise.allSettled(createdEmails.map((row) => indexEmailDoc(row)));

    res.status(201).json({
      scheduledCount: createdEmails.length,
      startTime: new Date(startMs).toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/scheduled', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const whereClause = and(
      eq(emails.userId, req.user!.id),
      inArray(emails.status, ['scheduled', 'processing']),
    );

    const [items, countRes] = await Promise.all([
      db
        .select({
          id: emails.id,
          recipient: emails.recipient,
          subject: emails.subject,
          scheduledAt: emails.scheduledAt,
          status: emails.status,
          senderId: emails.senderId,
        })
        .from(emails)
        .where(whereClause)
        .orderBy(desc(emails.scheduledAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(emails)
        .where(whereClause),
    ]);

    res.json({
      items,
      total: countRes[0]?.count ?? 0,
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/sent', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const whereClause = and(
      eq(emails.userId, req.user!.id),
      inArray(emails.status, ['sent', 'failed']),
    );

    const [items, countRes] = await Promise.all([
      db
        .select({
          id: emails.id,
          recipient: emails.recipient,
          subject: emails.subject,
          sentAt: emails.sentAt,
          scheduledAt: emails.scheduledAt,
          status: emails.status,
          previewUrl: emails.previewUrl,
          failureReason: emails.failureReason,
          senderId: emails.senderId,
        })
        .from(emails)
        .where(whereClause)
        .orderBy(desc(emails.sentAt), desc(emails.scheduledAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(emails)
        .where(whereClause),
    ]);

    res.json({
      items,
      total: countRes[0]?.count ?? 0,
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

    try {
      const result = await searchEmailsInEs({
        userId: req.user!.id,
        query: q,
        status,
        page,
        pageSize,
      });

      res.json({
        items: result.items,
        total: result.total,
        page,
        pageSize,
        source: 'elasticsearch',
      });
    } catch {
      const offset = (page - 1) * pageSize;
      const conditions = [eq(emails.userId, req.user!.id)];
      if (status === 'sent_or_failed') {
        conditions.push(inArray(emails.status, ['sent', 'failed']));
      } else if (status === 'scheduled') {
        conditions.push(inArray(emails.status, ['scheduled', 'processing']));
      }
      if (q.trim()) {
        const pattern = `%${q.trim()}%`;
        conditions.push(
          or(
            ilike(emails.recipient, pattern),
            ilike(emails.subject, pattern),
            ilike(emails.body, pattern),
          )!,
        );
      }

      const whereClause = and(...conditions);
      const [items, countRes] = await Promise.all([
        db
          .select({
            id: emails.id,
            recipient: emails.recipient,
            subject: emails.subject,
            scheduledAt: emails.scheduledAt,
            sentAt: emails.sentAt,
            status: emails.status,
            previewUrl: emails.previewUrl,
            failureReason: emails.failureReason,
            senderId: emails.senderId,
          })
          .from(emails)
          .where(whereClause)
          .orderBy(desc(emails.scheduledAt))
          .limit(pageSize)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(emails)
          .where(whereClause),
      ]);

      res.json({
        items,
        total: countRes[0]?.count ?? 0,
        page,
        pageSize,
        source: 'postgres_fallback',
      });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
