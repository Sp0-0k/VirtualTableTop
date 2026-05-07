import { Router } from 'express';
import type Database from 'better-sqlite3';
import { setSignedCookie } from '../auth/express-cookies.js';
import { COOKIE_PLAYER, COOKIE_MAX_AGE } from '../auth/constants.js';
import { createPlayer, findPlayerByName } from '../db/players.js';

const NAME_MIN = 1;
const NAME_MAX = 20;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function playerRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/player/join', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const color = typeof req.body?.color === 'string' ? req.body.color : '';

    if (name.length < NAME_MIN || name.length > NAME_MAX) {
      res.status(400).json({ error: 'name must be 1-20 characters' });
      return;
    }
    if (!COLOR_RE.test(color)) {
      res.status(400).json({ error: 'color must be a 6-digit hex string like #a1b2c3' });
      return;
    }

    const existing = findPlayerByName(db, name);
    const player = existing ?? createPlayer(db, name, color);

    setSignedCookie(res, COOKIE_PLAYER, String(player.id), {
      maxAgeSeconds: COOKIE_MAX_AGE,
    });

    res.json({ player });
  });

  return router;
}
