import { env } from './config/env.js';
import { closeDb } from './db/index.js';
import { closeRedis } from './config/redis.js';
import { closeEmailQueue } from './queue/emailQueue.js';
import { reconcileScheduledEmails } from './queue/reconcile.js';
import { startEmailWorker } from './queue/emailWorker.js';
import { ensureEmailIndex } from './services/search.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('Starting ReachInbox worker process...', {
    nodeEnv: env.NODE_ENV,
  });

  await ensureEmailIndex();
  await reconcileScheduledEmails();

  const worker = startEmailWorker();

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down worker gracefully...`);
    await worker.close();
    await closeEmailQueue();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Worker failed to start', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
