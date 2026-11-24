import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { senders } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { createEtherealSender } from '../services/email.js';

const router = Router();
router.use(requireAuth);

const createSenderSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const rows = await db
      .select({
        id: senders.id,
        name: senders.name,
        email: senders.email,
        smtpHost: senders.smtpHost,
        smtpPort: senders.smtpPort,
        createdAt: senders.createdAt,
      })
      .from(senders)
      .where(eq(senders.userId, req.user!.id))
      .orderBy(desc(senders.createdAt));

    res.json({ senders: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = createSenderSchema.parse(req.body ?? {});
    const created = await createEtherealSender({
      userId: req.user!.id,
      name: body.name,
    });

    res.status(201).json({
      sender: {
        id: created.id,
        name: created.name,
        email: created.email,
        smtpHost: created.smtpHost,
        smtpPort: created.smtpPort,
        createdAt: created.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
