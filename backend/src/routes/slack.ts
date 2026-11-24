import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import {
  buildSlackAuthorizeUrl,
  disconnectSlack,
  exchangeSlackCodeAndSave,
  getSlackStatus,
} from '../services/slack.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const status = await getSlackStatus(req.user!.id);
    res.json(status);
  } catch (err) {
    next(err);
  }
});

router.get('/connect', requireAuth, (req, res) => {
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    res.status(500).json({
      error: 'Slack OAuth is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.',
    });
    return;
  }

  const stateToken = jwt.sign(
    { userId: req.user!.id, purpose: 'slack_oauth' },
    env.JWT_SECRET,
    { expiresIn: '10m' },
  );

  const authorizeUrl = buildSlackAuthorizeUrl(stateToken);
  res.redirect(authorizeUrl);
});

router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) {
      res.redirect(`${env.FRONTEND_URL}/dashboard?slack=error&reason=${encodeURIComponent(String(error))}`);
      return;
    }

    if (typeof code !== 'string' || typeof state !== 'string') {
      res.redirect(`${env.FRONTEND_URL}/dashboard?slack=error&reason=missing_params`);
      return;
    }

    const decoded = jwt.verify(state, env.JWT_SECRET) as {
      userId: string;
      purpose: string;
    };

    if (decoded.purpose !== 'slack_oauth' || !decoded.userId) {
      res.redirect(`${env.FRONTEND_URL}/dashboard?slack=error&reason=invalid_state`);
      return;
    }

    await exchangeSlackCodeAndSave({
      code,
      userId: decoded.userId,
    });

    res.redirect(`${env.FRONTEND_URL}/dashboard?slack=connected`);
  } catch (err) {
    logger.error('Slack OAuth callback failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.redirect(`${env.FRONTEND_URL}/dashboard?slack=error`);
  }
});

router.delete('/disconnect', requireAuth, async (req, res, next) => {
  try {
    await disconnectSlack(req.user!.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
