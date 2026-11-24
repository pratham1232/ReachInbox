import type { NextFunction, Request, Response } from 'express';
import { AUTH_COOKIE_NAME, verifySessionJwt } from '../services/auth.js';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME] as string | undefined;
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const token = cookieToken || bearerToken;

  if (!token) {
    res.status(401).json({ error: 'Unauthorized: missing session token' });
    return;
  }

  try {
    req.user = verifySessionJwt(token);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized: invalid or expired session' });
  }
}
