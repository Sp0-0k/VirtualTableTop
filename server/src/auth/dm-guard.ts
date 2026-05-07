import type { RequestHandler } from 'express';
import { COOKIE_DM } from './constants.js';
import { readSignedCookie } from './express-cookies.js';

export const requireDm: RequestHandler = (req, res, next) => {
  if (readSignedCookie(req, COOKIE_DM) === '1') {
    next();
    return;
  }
  res.status(401).json({ error: 'dm authentication required' });
};
