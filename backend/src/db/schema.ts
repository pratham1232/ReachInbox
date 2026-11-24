import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const emailStatusEnum = pgEnum('email_status', [
  'scheduled',
  'processing',
  'sent',
  'failed',
]);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  googleId: text('google_id').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatar: text('avatar').default('').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const senders = pgTable(
  'senders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    smtpHost: text('smtp_host').notNull(),
    smtpPort: integer('smtp_port').notNull(),
    smtpSecure: boolean('smtp_secure').default(false).notNull(),
    smtpUser: text('smtp_user').notNull(),
    smtpPassEncrypted: text('smtp_pass_encrypted').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('senders_user_idx').on(table.userId)],
);

export const emails = pgTable(
  'emails',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => senders.id, { onDelete: 'cascade' }),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: emailStatusEnum('status').default('scheduled').notNull(),
    sequenceIndex: integer('sequence_index').default(0).notNull(),
    hourlyLimit: integer('hourly_limit'),
    delayBetweenEmailsMs: integer('delay_between_emails_ms'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    messageId: text('message_id'),
    previewUrl: text('preview_url'),
    failureReason: text('failure_reason'),
    esIndexed: boolean('es_indexed').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('emails_user_status_idx').on(table.userId, table.status),
    index('emails_scheduled_at_idx').on(table.scheduledAt),
    index('emails_sender_idx').on(table.senderId),
    index('emails_es_indexed_idx').on(table.esIndexed),
  ],
);

export const slackIntegrations = pgTable(
  'slack_integrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    teamId: text('team_id').notNull(),
    teamName: text('team_name').notNull(),
    channelId: text('channel_id'),
    channelName: text('channel_name'),
    botTokenEncrypted: text('bot_token_encrypted'),
    webhookUrlEncrypted: text('webhook_url_encrypted'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('slack_user_idx').on(table.userId)],
);

export type User = typeof users.$inferSelect;
export type Sender = typeof senders.$inferSelect;
export type Email = typeof emails.$inferSelect;
export type SlackIntegration = typeof slackIntegrations.$inferSelect;
