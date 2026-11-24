export interface AuthUserPayload {
  id: string;
  email: string;
  name: string;
  avatar: string;
}

export interface EmailJobData {
  emailId: string;
  userId: string;
  senderId: string;
  sequenceIndex: number;
  hourlyLimit?: number | null;
  delayBetweenEmailsMs?: number | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}
