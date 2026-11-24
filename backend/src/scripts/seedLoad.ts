import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, closeDb } from '../db/index.js';
import { emails, users } from '../db/schema.js';
import { createDryRunSender } from '../services/email.js';
import { enqueueEmailJobsBulk, closeEmailQueue } from '../queue/emailQueue.js';
import { computeRescheduleTimestampMs, getHourWindowInfo } from '../services/rateLimiter.js';
import { closeRedis } from '../config/redis.js';

async function main() {
  const totalEmails = Number(process.env.LOAD_COUNT ?? 1050);
  const hourlyLimit = Number(process.env.LOAD_HOURLY_LIMIT ?? 100);
  const minDelayMs = Number(process.env.LOAD_DELAY_MS ?? 50);

  let [user] = await db.select().from(users).limit(1);
  if (!user) {
    [user] = await db
      .insert(users)
      .values({
        googleId: 'seed-load-user',
        email: 'loadtest@reachinbox.local',
        name: 'Load Test User',
        avatar: '',
      })
      .returning();
  }

  const sender = await createDryRunSender({
    userId: user.id,
    name: 'Load Test Sender',
  });

  const startMs = Date.now() + 2000;
  const rowsToInsert = Array.from({ length: totalEmails }, (_, idx) => ({
    userId: user.id,
    senderId: sender.id,
    recipient: `lead-${idx + 1}@example.com`,
    subject: `Load Test Campaign #${idx + 1}`,
    body: `Hello lead ${idx + 1}, this is a scheduled load test message.`,
    status: 'scheduled' as const,
    sequenceIndex: idx,
    hourlyLimit,
    delayBetweenEmailsMs: minDelayMs,
    scheduledAt: new Date(startMs), // all scheduled for the exact same time
  }));

  const inserted = await db.insert(emails).values(rowsToInsert).returning();

  await enqueueEmailJobsBulk(
    inserted.map((row) => ({
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

  // Simulate and log expected hour-window distribution under the configured hourlyLimit
  const { nextHourStartMs } = getHourWindowInfo(startMs);
  const windowCounts = new Map<string, number>();

  for (let i = 0; i < totalEmails; i++) {
    if (i < hourlyLimit) {
      const win = getHourWindowInfo(startMs).hourWindow;
      windowCounts.set(win, (windowCounts.get(win) ?? 0) + 1);
    } else {
      const targetTs = computeRescheduleTimestampMs({
        nextHourStartMs,
        sequenceIndex: i,
        minDelayMs,
        hourlyLimit,
      });
      const win = getHourWindowInfo(targetTs).hourWindow;
      windowCounts.set(win, (windowCounts.get(win) ?? 0) + 1);
    }
  }

  console.log(`\nScheduled ${inserted.length} emails for ${new Date(startMs).toISOString()}`);
  console.log(`Sender: ${sender.email} (${sender.id}), Hourly Limit: ${hourlyLimit}`);
  console.log('Expected distribution across hour windows:');
  for (const [window, count] of windowCounts.entries()) {
    console.log(`  Window ${window}:00 UTC -> ${count} emails`);
  }
  console.log('\nTip: Run worker with DRY_RUN=true to process without hitting Ethereal SMTP.');

  // Verify count in DB
  const dbCount = await db
    .select({ id: emails.id })
    .from(emails)
    .where(eq(emails.senderId, sender.id));
  console.log(`Verified ${dbCount.length} rows in PostgreSQL for sender ${sender.id}.\n`);

  await closeEmailQueue();
  await closeRedis();
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
