export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatar: string;
}

export interface SenderAccount {
  id: string;
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  createdAt: string;
}

export type EmailStatus = 'scheduled' | 'processing' | 'sent' | 'failed';

export interface ScheduledEmailItem {
  id: string;
  recipient: string;
  subject: string;
  scheduledAt: string;
  status: EmailStatus;
  senderId: string;
}

export interface SentEmailItem {
  id: string;
  recipient: string;
  subject: string;
  sentAt: string | null;
  scheduledAt: string;
  status: EmailStatus;
  previewUrl: string | null;
  failureReason: string | null;
  senderId: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SlackStatus {
  connected: boolean;
  teamName: string | null;
  channelName: string | null;
}

export interface ScheduleEmailPayload {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
  senderId?: string;
}
