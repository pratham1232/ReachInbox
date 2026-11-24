import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { EmailJobData } from '../../types/index.js';

const mockClaimEmailForProcessing = vi.fn();
const mockSendEmailViaSmtp = vi.fn();
const mockMarkEmailSent = vi.fn();

vi.mock('../email.js', () => ({
  claimEmailForProcessing: (...args: unknown[]) => mockClaimEmailForProcessing(...args),
  sendEmailViaSmtp: (...args: unknown[]) => mockSendEmailViaSmtp(...args),
  markEmailSent: (...args: unknown[]) => mockMarkEmailSent(...args),
  markEmailFailed: vi.fn(),
  releaseEmailClaimForDelay: vi.fn(),
}));

import { processEmailJob } from '../../queue/emailWorker.js';

describe('Idempotent email claim in worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips sending when atomic claim returns null (already claimed or sent)', async () => {
    mockClaimEmailForProcessing.mockResolvedValueOnce(null);

    const fakeJob = {
      id: 'email-uuid-1',
      data: {
        emailId: 'email-uuid-1',
        userId: 'user-1',
        senderId: 'sender-1',
        sequenceIndex: 0,
      },
      opts: { attempts: 5 },
      attemptsMade: 0,
    } as unknown as Job<EmailJobData>;

    const result = await processEmailJob(fakeJob, 'token-1');

    expect(result).toEqual({ status: 'skipped' });
    expect(mockClaimEmailForProcessing).toHaveBeenCalledWith('email-uuid-1');
    expect(mockSendEmailViaSmtp).not.toHaveBeenCalled();
    expect(mockMarkEmailSent).not.toHaveBeenCalled();
  });
});
