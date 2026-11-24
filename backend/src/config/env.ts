import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  RUN_WORKER_IN_API: z
    .string()
    .optional()
    .transform((val) => val === 'true'),

  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://postgres:postgres@localhost:5432/reachinbox'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  ELASTICSEARCH_URL: z.string().url().default('http://localhost:9200'),
  ELASTICSEARCH_API_KEY: z.string().optional(),
  ELASTICSEARCH_INDEX: z.string().min(1).default('emails'),

  JWT_SECRET: z.string().min(16).default('dev-jwt-secret-change-me-in-prod-12345'),
  ENCRYPTION_KEY: z
    .string()
    .min(32)
    .default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  COOKIE_DOMAIN: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_CALLBACK_URL: z
    .string()
    .url()
    .default('http://localhost:4000/api/auth/google/callback'),

  SLACK_CLIENT_ID: z.string().default(''),
  SLACK_CLIENT_SECRET: z.string().default(''),
  SLACK_REDIRECT_URI: z
    .string()
    .url()
    .default('http://localhost:4000/api/slack/callback'),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  MIN_DELAY_BETWEEN_EMAILS_MS: z.coerce.number().int().nonnegative().default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().positive().default(100),
  MAX_EMAILS_PER_HOUR: z.coerce.number().int().positive().default(500),
  STALE_PROCESSING_THRESHOLD_MS: z.coerce.number().int().positive().default(300000),
  DRY_RUN: z
    .string()
    .optional()
    .transform((val) => val === 'true'),

  BULL_BOARD_USER: z.string().min(1).default('admin'),
  BULL_BOARD_PASSWORD: z.string().min(1).default('changeme'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
