import { Router } from 'express';
import { setSignedCookie } from '../auth/express-cookies.js';
import { COOKIE_DM, COOKIE_MAX_AGE } from '../auth/constants.js';

export function dmRouter(): Router {
  const router = Router();

  router.get('/bootstrap', (_req, res) => {
    setSignedCookie(res, COOKIE_DM, '1', { maxAgeSeconds: COOKIE_MAX_AGE });
    res.json({ ok: true });
  });

  return router;
}
