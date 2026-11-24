import { Router } from 'express';
import { env } from '../config/env.js';
import {
  AUTH_COOKIE_NAME,
  authenticateGoogleCode,
  findUserById,
  getGoogleAuthUrl,
  signSessionJwt,
} from '../services/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/google', (_req, res) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    res.status(500).json({
      error: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    });
    return;
  }
  const url = getGoogleAuthUrl();
  res.redirect(url);
});

router.get('/google/callback', async (req, res, next) => {
  try {
    const code = req.query.code;
    if (typeof code !== 'string' || !code) {
      res.redirect(`${env.FRONTEND_URL}/login?error=missing_code`);
      return;
    }

    const user = await authenticateGoogleCode(code);
    const token = signSessionJwt(user);

    const isProd = env.NODE_ENV === 'production';
    res.cookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: isProd ? 'none' : 'lax',
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      ...(env.COOKIE_DOMAIN && env.COOKIE_DOMAIN !== 'localhost'
        ? { domain: env.COOKIE_DOMAIN }
        : {}),
    });

    res.redirect(`${env.FRONTEND_URL}/dashboard`);
  } catch (err) {
    logger.error('Google OAuth callback error', {
      error: err instanceof Error ? err.message : String(err),
    });
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await findUserById(req.user!.id);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (_req, res) => {
  const isProd = env.NODE_ENV === 'production';
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
  });
  res.json({ ok: true });
});

export default router;
