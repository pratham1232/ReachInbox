import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { slackIntegrations } from '../db/schema.js';
import { env } from '../config/env.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { redis } from '../config/redis.js';

export function buildSlackAuthorizeUrl(stateToken: string): string {
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    scope: 'incoming-webhook,chat:write',
    redirect_uri: env.SLACK_REDIRECT_URI,
    state: stateToken,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  team?: { id: string; name: string };
  incoming_webhook?: {
    url: string;
    channel: string;
    channel_id: string;
  };
}

export async function exchangeSlackCodeAndSave(params: {
  code: string;
  userId: string;
}): Promise<{ teamName: string; channelName: string | null }> {
  const body = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    client_secret: env.SLACK_CLIENT_SECRET,
    code: params.code,
    redirect_uri: env.SLACK_REDIRECT_URI,
  });

  const resp = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = (await resp.json()) as SlackOAuthResponse;
  logger.info('Slack OAuth v2 exchange response', {
    ok: data.ok,
    error: data.error,
    teamId: data.team?.id,
    userId: params.userId,
  });

  if (!data.ok || !data.team) {
    throw new Error(`Slack OAuth failed: ${data.error || 'unknown_error'}`);
  }

  const botTokenEnc = data.access_token ? encryptSecret(data.access_token) : null;
  const webhookUrlEnc = data.incoming_webhook?.url
    ? encryptSecret(data.incoming_webhook.url)
    : null;

  await db
    .insert(slackIntegrations)
    .values({
      userId: params.userId,
      teamId: data.team.id,
      teamName: data.team.name,
      channelId: data.incoming_webhook?.channel_id ?? null,
      channelName: data.incoming_webhook?.channel ?? null,
      botTokenEncrypted: botTokenEnc,
      webhookUrlEncrypted: webhookUrlEnc,
      isActive: true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: slackIntegrations.userId,
      set: {
        teamId: data.team.id,
        teamName: data.team.name,
        channelId: data.incoming_webhook?.channel_id ?? null,
        channelName: data.incoming_webhook?.channel ?? null,
        botTokenEncrypted: botTokenEnc,
        webhookUrlEncrypted: webhookUrlEnc,
        isActive: true,
        updatedAt: new Date(),
      },
    });

  return {
    teamName: data.team.name,
    channelName: data.incoming_webhook?.channel ?? null,
  };
}

export async function getSlackStatus(userId: string) {
  const [integration] = await db
    .select()
    .from(slackIntegrations)
    .where(eq(slackIntegrations.userId, userId));

  if (!integration || !integration.isActive) {
    return { connected: false, teamName: null, channelName: null };
  }

  return {
    connected: true,
    teamName: integration.teamName,
    channelName: integration.channelName,
  };
}

export async function disconnectSlack(userId: string): Promise<void> {
  await db.delete(slackIntegrations).where(eq(slackIntegrations.userId, userId));
  logger.info('Disconnected Slack integration', { userId });
}

/**
 * Sends a Slack notification when a sender hits its hourly limit.
 * Deduped once per sender per hour window via Redis SET NX.
 * Looks up integration at notify time so connecting/disconnecting works immediately without restart.
 */
export async function notifyRateLimitHit(params: {
  userId: string;
  senderId: string;
  senderEmail: string;
  limit: number;
  hourWindow: string;
  deferredCount: number;
}): Promise<void> {
  const dedupeKey = `slack:notified:${params.senderId}:${params.hourWindow}`;
  const acquired = await redis.set(dedupeKey, '1', 'EX', 3700, 'NX');
  if (acquired !== 'OK') {
    return;
  }

  const [integration] = await db
    .select()
    .from(slackIntegrations)
    .where(eq(slackIntegrations.userId, params.userId));

  if (!integration || !integration.isActive) {
    logger.debug('Slack notification skipped: no active integration', {
      userId: params.userId,
      senderId: params.senderId,
    });
    return;
  }

  const text = [
    `:warning: *ReachInbox Hourly Rate Limit Reached*`,
    `• *Sender:* ${params.senderEmail}`,
    `• *Hourly Limit:* ${params.limit} emails/hour`,
    `• *Hour Window:* ${params.hourWindow}:00 UTC`,
    `• *Deferred Emails:* ${params.deferredCount} (rescheduled to next hour window)`,
  ].join('\n');

  try {
    if (integration.webhookUrlEncrypted) {
      const webhookUrl = decryptSecret(integration.webhookUrlEncrypted);
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const respText = await resp.text();
      logger.info('Slack webhook call completed', {
        userId: params.userId,
        senderId: params.senderId,
        status: resp.status,
        body: respText,
      });

      if (resp.status === 403 || resp.status === 404 || resp.status === 410) {
        await markIntegrationInactive(params.userId, `webhook_status_${resp.status}`);
      }
      return;
    }

    if (integration.botTokenEncrypted && integration.channelId) {
      const token = decryptSecret(integration.botTokenEncrypted);
      const resp = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ channel: integration.channelId, text }),
      });
      const result = (await resp.json()) as { ok: boolean; error?: string };
      logger.info('Slack chat.postMessage call completed', {
        userId: params.userId,
        senderId: params.senderId,
        ok: result.ok,
        error: result.error,
      });

      if (!result.ok && (result.error === 'invalid_auth' || result.error === 'token_revoked' || result.error === 'account_inactive')) {
        await markIntegrationInactive(params.userId, result.error);
      }
    }
  } catch (err) {
    logger.error('Slack notification failed', {
      userId: params.userId,
      senderId: params.senderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function markIntegrationInactive(userId: string, reason: string): Promise<void> {
  await db
    .update(slackIntegrations)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(slackIntegrations.userId, userId));
  logger.warn('Marked Slack integration inactive due to invalid/revoked credentials', {
    userId,
    reason,
  });
}
