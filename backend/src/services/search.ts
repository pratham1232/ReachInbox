import { Client } from '@elastic/elasticsearch';
import { eq } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { emails, type Email } from '../db/schema.js';
import { logger } from '../utils/logger.js';

export const esClient = new Client({
  node: env.ELASTICSEARCH_URL,
});

export async function ensureEmailIndex(): Promise<void> {
  try {
    const exists = await esClient.indices.exists({ index: env.ELASTICSEARCH_INDEX });
    if (!exists) {
      await esClient.indices.create({
        index: env.ELASTICSEARCH_INDEX,
        mappings: {
          properties: {
            userId: { type: 'keyword' },
            senderId: { type: 'keyword' },
            recipient: {
              type: 'text',
              fields: { keyword: { type: 'keyword' } },
            },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
            previewUrl: { type: 'keyword', index: false },
          },
        },
      });
      logger.info('Created Elasticsearch index', { index: env.ELASTICSEARCH_INDEX });
    }
  } catch (err) {
    logger.warn('Elasticsearch index initialization failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function indexEmailDoc(email: Email): Promise<void> {
  try {
    await esClient.index({
      index: env.ELASTICSEARCH_INDEX,
      id: email.id,
      document: {
        userId: email.userId,
        senderId: email.senderId,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        status: email.status,
        scheduledAt: email.scheduledAt.toISOString(),
        sentAt: email.sentAt ? email.sentAt.toISOString() : null,
        previewUrl: email.previewUrl ?? null,
      },
    });
    await db
      .update(emails)
      .set({ esIndexed: true })
      .where(eq(emails.id, email.id));
  } catch (err) {
    logger.warn('Elasticsearch indexing failed (non-fatal; will retry via reindex)', {
      emailId: email.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function updateEmailDocStatus(email: Email): Promise<void> {
  try {
    await esClient.update({
      index: env.ELASTICSEARCH_INDEX,
      id: email.id,
      doc: {
        status: email.status,
        sentAt: email.sentAt ? email.sentAt.toISOString() : null,
        previewUrl: email.previewUrl ?? null,
      },
      doc_as_upsert: true,
    });
    await db
      .update(emails)
      .set({ esIndexed: true })
      .where(eq(emails.id, email.id));
  } catch (err) {
    logger.warn('Elasticsearch status update failed (non-fatal)', {
      emailId: email.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function searchEmailsInEs(params: {
  userId: string;
  query: string;
  status?: string;
  page: number;
  pageSize: number;
}) {
  const must: Record<string, unknown>[] = [{ term: { userId: params.userId } }];

  if (params.status) {
    if (params.status === 'sent_or_failed') {
      must.push({ terms: { status: ['sent', 'failed'] } });
    } else {
      must.push({ term: { status: params.status } });
    }
  }

  if (params.query.trim()) {
    must.push({
      multi_match: {
        query: params.query.trim(),
        fields: ['recipient^2', 'subject^2', 'body'],
        fuzziness: 'AUTO',
      },
    });
  }

  const from = (params.page - 1) * params.pageSize;
  const response = await esClient.search({
    index: env.ELASTICSEARCH_INDEX,
    from,
    size: params.pageSize,
    sort: [{ scheduledAt: { order: 'desc' } }],
    query: {
      bool: { must },
    },
  });

  const totalObj = response.hits.total;
  const total = typeof totalObj === 'number' ? totalObj : (totalObj?.value ?? 0);

  const items = response.hits.hits.map((hit) => ({
    id: hit._id,
    ...(hit._source as Record<string, unknown>),
  }));

  return { items, total };
}
