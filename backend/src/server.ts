import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { env } from './config/env.js';
import { closeDb, pool } from './db/index.js';
import { closeRedis, redis } from './config/redis.js';
import { closeEmailQueue, emailQueue } from './queue/emailQueue.js';
import { reconcileScheduledEmails } from './queue/reconcile.js';
import { startEmailWorker } from './queue/emailWorker.js';
import { ensureEmailIndex } from './services/search.js';
import { errorHandler, requestLogger } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import senderRoutes from './routes/senders.js';
import emailRoutes from './routes/emails.js';
import slackRoutes from './routes/slack.js';
import { logger } from './utils/logger.js';
import type { Worker } from 'bullmq';

function basicAuthMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="ReachInbox BullBoard"');
    res.status(401).send('Authentication required');
    return;
  }

  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const [user, pass] = decoded.split(':');
  if (user !== env.BULL_BOARD_USER || pass !== env.BULL_BOARD_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="ReachInbox BullBoard"');
    res.status(401).send('Invalid credentials');
    return;
  }

  next();
}

async function bootstrap() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(requestLogger);

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      await redis.ping();
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({
        status: 'degraded',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Bull Board live queue dashboard
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');
  createBullBoard({
    queues: [new BullMQAdapter(emailQueue)],
    serverAdapter,
  });
  app.use('/admin/queues', basicAuthMiddleware, serverAdapter.getRouter());

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/senders', senderRoutes);
  app.use('/api/emails', emailRoutes);
  app.use('/api/slack', slackRoutes);

  app.use(errorHandler);

  await ensureEmailIndex();
  await reconcileScheduledEmails();

  let embeddedWorker: Worker | null = null;
  if (env.RUN_WORKER_IN_API || process.argv.includes('--with-worker')) {
    embeddedWorker = startEmailWorker();
  }

  const server = app.listen(env.PORT, () => {
    logger.info(`ReachInbox API listening on http://localhost:${env.PORT}`, {
      bullBoard: `http://localhost:${env.PORT}/admin/queues`,
      embeddedWorker: Boolean(embeddedWorker),
    });
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down API server gracefully...`);
    server.closeAllConnections();
    server.close(async () => {
      if (embeddedWorker) {
        await embeddedWorker.close();
      }
      await closeEmailQueue();
      await closeRedis();
      await closeDb();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.error('Failed to start server', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
