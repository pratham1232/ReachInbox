const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedRecipientsResult {
  validEmails: string[];
  invalidEntries: string[];
  duplicateCount: number;
}

/**
 * Parses CSV or plain-text recipient lists (commas, semicolons, newlines, tabs, or quoted CSV cells),
 * validates email syntax, and deduplicates case-insensitively while preserving order.
 */
export function parseRecipientsText(rawText: string): ParsedRecipientsResult {
  const tokens = rawText
    .split(/[\r\n,;\t]+/)
    .map((t) => t.replace(/^["'\s]+|["'\s]+$/g, '').trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const validEmails: string[] = [];
  const invalidEntries: string[] = [];
  let duplicateCount = 0;

  for (const token of tokens) {
    // Skip common CSV header names
    if (token.toLowerCase() === 'email' || token.toLowerCase() === 'emails') {
      continue;
    }

    const normalized = token.toLowerCase();
    if (!EMAIL_REGEX.test(normalized)) {
      invalidEntries.push(token);
      continue;
    }

    if (seen.has(normalized)) {
      duplicateCount += 1;
      continue;
    }

    seen.add(normalized);
    validEmails.push(normalized);
  }

  return { validEmails, invalidEntries, duplicateCount };
}
