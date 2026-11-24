import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, closeDb } from '../db/index.js';
import { emails } from '../db/schema.js';
import { ensureEmailIndex, indexEmailDoc } from '../services/search.js';

async function main() {
  await ensureEmailIndex();
  const pending = await db
    .select()
    .from(emails)
    .where(eq(emails.esIndexed, false));

  console.log(`Found ${pending.length} emails needing Elasticsearch indexing...`);
  for (const row of pending) {
    await indexEmailDoc(row);
  }
  console.log('Re-indexing complete.');
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
