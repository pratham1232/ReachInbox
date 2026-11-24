# ReachInbox Full-Stack Email Job Scheduler

A production-grade email scheduler service and dashboard built with TypeScript, Express, BullMQ + Redis, PostgreSQL (Drizzle ORM), Nodemailer (Ethereal SMTP), Elasticsearch, `@bull-board/express`, and React (Vite + Tailwind CSS).

---

## Tech Stack

- **Backend**: Node.js, TypeScript, Express.js, BullMQ + Redis, PostgreSQL + Drizzle ORM, Nodemailer (Ethereal SMTP), Elasticsearch (`@elastic/elasticsearch`), `@bull-board/express`, Google OAuth (`google-auth-library`), Slack OAuth v2, Zod
- **Frontend**: React 18 (Vite), TypeScript, Tailwind CSS, TanStack React Query, Lucide Icons
- **Infrastructure**: Docker Compose (`postgres:16-alpine`, `redis:7-alpine`, `elasticsearch:8.15.0`)

---

## Setup & Running Locally

### 1. Start Infrastructure (Redis, PostgreSQL, Elasticsearch)
```bash
docker compose up -d
```
Verify all three services are healthy:
```bash
docker compose ps
```

### 2. Configure Environment Variables

Copy the example files and fill in your credentials:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

#### Backend Environment Variables (`backend/.env`)
| Variable | Description | Default / Example |
|---|---|---|
| `PORT` | Express API port | `4000` |
| `FRONTEND_URL` | Frontend origin for CORS & OAuth redirects | `http://localhost:5173` |
| `RUN_WORKER_IN_API` | Run BullMQ worker inside API process (`true`/`false`) | `false` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/reachinbox` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `ELASTICSEARCH_URL` | Elasticsearch single-node URL | `http://localhost:9200` |
| `ELASTICSEARCH_INDEX` | ES index name for emails | `emails` |
| `JWT_SECRET` | Secret for signing httpOnly session cookies | (32+ char random string) |
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM encryption of Slack/SMTP secrets | (64 hex chars) |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret | — |
| `GOOGLE_CALLBACK_URL` | Google OAuth callback URL | `http://localhost:4000/api/auth/google/callback` |
| `SLACK_CLIENT_ID` | Slack App Client ID | — |
| `SLACK_CLIENT_SECRET` | Slack App Client Secret | — |
| `SLACK_REDIRECT_URI` | Slack OAuth v2 redirect URI | `http://localhost:4000/api/slack/callback` |
| `WORKER_CONCURRENCY` | BullMQ worker parallel job concurrency | `5` |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | Minimum delay per sender between sends (ms) | `2000` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Default hourly limit per sender | `100` |
| `MAX_EMAILS_PER_HOUR` | Global hourly limit across all senders | `500` |
| `STALE_PROCESSING_THRESHOLD_MS` | Age threshold to reset stale `processing` rows on boot | `300000` |
| `DRY_RUN` | Skip real SMTP calls (useful for `seed:load` testing) | `false` |
| `BULL_BOARD_USER` | Basic auth username for `/admin/queues` | `admin` |
| `BULL_BOARD_PASSWORD` | Basic auth password for `/admin/queues` | `changeme` |

#### OAuth App Setup
- **Google Cloud Console**: Create an OAuth 2.0 Client ID (Web application) and add `http://localhost:4000/api/auth/google/callback` as an Authorized Redirect URI.
- **Slack API**: Create a Slack App → OAuth & Permissions → add `incoming-webhook` and `chat:write` bot scopes, and register your `SLACK_REDIRECT_URI` (note: Slack requires `https://`, e.g., via ngrok/cloudflared for local dev).
- **Ethereal SMTP**: No manual signup required — clicking **"New Ethereal Sender"** in the Compose modal (or `POST /api/senders`) dynamically provisions an Ethereal test account via `nodemailer.createTestAccount()`.

### 3. Push Database Schema & Start Backend + Worker
```bash
cd backend
npm install
npm run db:push
npm run dev      # Terminal 1: API server + Bull Board (/admin/queues)
npm run worker   # Terminal 2: BullMQ worker process
```

### 4. Start Frontend
```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
```

---

## Architecture Overview

### Scheduling (Zero Cron)
- No `cron`, `node-cron`, or polling loops are used anywhere.
- `POST /api/emails/schedule` inserts one PostgreSQL row per recipient (`status = 'scheduled'`) inside a transaction, computing staggered timestamps (`startTime + i * delayBetweenEmailsMs`), and bulk-enqueues one BullMQ **delayed job** per email with `delay = max(0, scheduledAt - now)`.

### Persistence & Boot Reconciliation
- All pending jobs live in **Redis** (BullMQ delayed set) and **PostgreSQL** (`emails` table).
- On boot (`reconcileScheduledEmails` in `backend/src/queue/reconcile.ts`):
  1. Resets stale `processing` rows (`messageId IS NULL` and `processingStartedAt` older than `STALE_PROCESSING_THRESHOLD_MS`) back to `scheduled`.
  2. Queries all `scheduled` rows in PostgreSQL and checks `emailQueue.getJob(row.id)`. Any missing job is re-enqueued using `jobId = row.id`.

### Two-Layer Idempotency
1. **Queue Layer**: BullMQ `jobId` is set to the PostgreSQL `emails.id` UUID, so duplicate enqueues are no-ops.
2. **Database Layer**: Before sending, the worker executes an atomic claim:
   ```sql
   UPDATE emails SET status = 'processing', processing_started_at = NOW()
   WHERE id = $1 AND status = 'scheduled'
   RETURNING *;
   ```
   If `0` rows are returned, the worker skips the job.
- **Crash Trade-off (At-Least-Once vs At-Most-Once)**: Because `status = 'sent'` is written *after* SMTP succeeds, a crash in the narrow window between `sendMail()` and `UPDATE ... SET status = 'sent'` leaves the row in `processing` without a `messageId`. Setting `STALE_PROCESSING_THRESHOLD_MS` conservatively favors **at-least-once** delivery on crash recovery while preventing duplicate sends across concurrent workers.

### Concurrency, Minimum Delay & Rate Limiting
- **Per-Sender Minimum Delay**: Enforced via a Redis lock (`SET sender:lock:{senderId} 1 PX {delayMs} NX`). If held, the worker releases the DB claim back to `scheduled`, calls `job.moveToDelayed(now + remainingMs)`, and throws `DelayedError` (so it does not consume retry attempts).
- **Atomic Hourly Rate Limit**: Enforced via a Redis Lua script (`rate:{senderId}:{hourWindow}` and `rate:global:{hourWindow}`) that checks limits *before* incrementing (`INCR` + `EXPIRE`), ensuring rejected attempts never inflate counters.
- **Order-Preserving Rescheduling**: When a limit is hit, the job is moved to the next hour window at `nextHourStartMs + overflowWindows * 1h + (sequenceIndex % hourlyLimit) * minDelayMs`, preserving campaign sequence order.

---

## Feature Checklist

### Backend
- [x] `POST /api/emails/schedule` with Zod validation, transactional DB inserts, staggered times
- [x] Two-layer idempotency (BullMQ `jobId` + atomic `UPDATE ... WHERE status='scheduled'`)
- [x] Boot reconciliation for missed `scheduled` jobs and stale `processing` rows
- [x] Ethereal SMTP sender creation & round-robin/explicit sender selection
- [x] Redis Lua atomic hourly rate limiter + per-sender `SET NX PX` minimum delay lock
- [x] Order-preserving `moveToDelayed` + `DelayedError` deferral on rate-limit hit
- [x] Real Slack OAuth v2 + encrypted token/webhook storage + deduped rate-limit notifications
- [x] Elasticsearch `emails` index, non-fatal indexing, `GET /api/emails/search`, and `npm run es:reindex`
- [x] `@bull-board/express` mounted at `/admin/queues` with Basic Auth
- [x] Real Google OAuth login, httpOnly JWT cookies, `/api/auth/me`, `/api/auth/logout`
- [x] `npm run seed:load` script (1,000+ emails with `DRY_RUN=true`)

### Frontend
- [x] Google OAuth Login page
- [x] Dashboard header with user profile, Logout, and Connect/Disconnect Slack
- [x] Compose New Email modal with client-side CSV/text parsing, deduplication, and email count
- [x] Scheduled Emails & Sent Emails tabs with Elasticsearch search, pagination, status badges, Ethereal preview links, and polling

---

## Demo Script

1. **Schedule & Send**: Log in with Google, create an Ethereal sender in **Compose New Email**, upload/paste 3 recipients scheduled 1 minute out with a `2000ms` delay, and watch them move from **Scheduled Emails** to **Sent Emails** with clickable Ethereal preview links.
2. **Restart Persistence**: Schedule emails 2 minutes out, stop both the API server and worker (`Ctrl+C`), restart them (`npm run dev` / `npm run worker`), and confirm boot reconciliation logs and that all emails send once at their scheduled time.
3. **Rate Limiting & Slack Alert**: Connect Slack from the header, schedule 10 emails with `hourlyLimit = 3`, and observe 3 emails sent immediately, 7 deferred to the next hour window in `/admin/queues`, and a real Slack notification posted once for that sender/window.
4. **Load Test (1,000+ Emails)**:
   ```bash
   cd backend
   DRY_RUN=true npm run seed:load
   DRY_RUN=true npm run worker
   ```

---

## Assumptions, Shortcuts & Trade-offs

- **Figma Design**: No Figma link or screenshots were provided at build time, so a clean, modern SaaS dashboard layout (Tailwind CSS + Lucide icons) was implemented with reusable UI primitives ready for visual adjustments.
- **Slack OAuth Localhost**: Slack's OAuth v2 redirect URI requires HTTPS in production/dev; use a tunnel (e.g. `ngrok http 4000`) for `SLACK_REDIRECT_URI` when testing the live OAuth flow locally.
- **At-Least-Once Delivery**: Email `status = 'sent'` is persisted after SMTP confirmation; crashing between SMTP send and DB commit is handled conservatively via `STALE_PROCESSING_THRESHOLD_MS` reconciliation.
