import { describe, expect, it } from 'vitest';
import { parseRecipientsText } from '../csvParser';

describe('parseRecipientsText', () => {
  it('parses CSV/text with newlines, commas, quotes, and headers, deduplicating case-insensitively', () => {
    const input = `
      email
      "Alice@Example.com", bob@test.org
      alice@example.com
      charlie@company.io; not-an-email
      dave@domain.co
    `;

    const result = parseRecipientsText(input);

    expect(result.validEmails).toEqual([
      'alice@example.com',
      'bob@test.org',
      'charlie@company.io',
      'dave@domain.co',
    ]);
    expect(result.duplicateCount).toBe(1);
    expect(result.invalidEntries).toEqual(['not-an-email']);
  });

  it('returns empty arrays for blank input', () => {
    const result = parseRecipientsText('   \n  ,  ');
    expect(result.validEmails).toEqual([]);
    expect(result.invalidEntries).toEqual([]);
    expect(result.duplicateCount).toBe(0);
  });
});
