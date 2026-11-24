import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import type { AuthUserPayload } from '../types/index.js';

export const AUTH_COOKIE_NAME = 'reachinbox_session';

const oauthClient = new OAuth2Client(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_CALLBACK_URL,
);

export function getGoogleAuthUrl(state?: string): string {
  return oauthClient.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
    ...(state ? { state } : {}),
  });
}

export async function authenticateGoogleCode(code: string): Promise<AuthUserPayload> {
  const { tokens } = await oauthClient.getToken(code);
  if (!tokens.id_token) {
    throw new Error('Google OAuth response missing id_token');
  }

  const ticket = await oauthClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new Error('Invalid Google ID token payload');
  }

  const googleId = payload.sub;
  const email = payload.email;
  const name = payload.name || email.split('@')[0];
  const avatar = payload.picture || '';

  const [user] = await db
    .insert(users)
    .values({
      googleId,
      email,
      name,
      avatar,
    })
    .onConflictDoUpdate({
      target: users.googleId,
      set: {
        email,
        name,
        avatar,
        updatedAt: new Date(),
      },
    })
    .returning();

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
  };
}

export function signSessionJwt(user: AuthUserPayload): string {
  return jwt.sign(user, env.JWT_SECRET, { expiresIn: '7d' });
}

export function verifySessionJwt(token: string): AuthUserPayload {
  return jwt.verify(token, env.JWT_SECRET) as AuthUserPayload;
}

export async function findUserById(userId: string): Promise<AuthUserPayload | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
  };
}
