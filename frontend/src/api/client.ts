import type {
  AuthUser,
  PaginatedResponse,
  ScheduleEmailPayload,
  ScheduledEmailItem,
  SenderAccount,
  SentEmailItem,
  SlackStatus,
} from '../types';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getMe: () => request<AuthUser>('/api/auth/me'),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  getSenders: () => request<{ senders: SenderAccount[] }>('/api/senders'),
  createSender: (name?: string) =>
    request<{ sender: SenderAccount }>('/api/senders', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  scheduleEmails: (payload: ScheduleEmailPayload) =>
    request<{ scheduledCount: number; startTime: string }>('/api/emails/schedule', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getScheduledEmails: (page = 1, pageSize = 20) =>
    request<PaginatedResponse<ScheduledEmailItem>>(
      `/api/emails/scheduled?page=${page}&pageSize=${pageSize}`,
    ),

  getSentEmails: (page = 1, pageSize = 20) =>
    request<PaginatedResponse<SentEmailItem>>(
      `/api/emails/sent?page=${page}&pageSize=${pageSize}`,
    ),

  searchEmails: <T>(q: string, status: string, page = 1, pageSize = 20) =>
    request<PaginatedResponse<T>>(
      `/api/emails/search?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&page=${page}&pageSize=${pageSize}`,
    ),

  getSlackStatus: () => request<SlackStatus>('/api/slack/status'),
  disconnectSlack: () =>
    request<{ ok: boolean }>('/api/slack/disconnect', { method: 'DELETE' }),
};
