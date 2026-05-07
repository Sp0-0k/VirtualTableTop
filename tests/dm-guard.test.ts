import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { signCookie } from '../server/src/auth/cookies.js';
import { COOKIE_DM, COOKIE_PLAYER } from '../server/src/auth/constants.js';
import { requireDm } from '../server/src/auth/dm-guard.js';

function makeApp() {
  const app = express();
  app.use(requireDm);
  app.get('/', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('requireDm middleware', () => {
  it('rejects requests without a vtt_dm cookie', async () => {
    const res = await request(makeApp()).get('/');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/dm/i);
  });

  it('rejects requests with only a player cookie', async () => {
    const cookie = `${COOKIE_PLAYER}=${signCookie('1')}`;
    const res = await request(makeApp()).get('/').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('rejects a tampered DM cookie', async () => {
    const cookie = `${COOKIE_DM}=1.deadbeef`;
    const res = await request(makeApp()).get('/').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('allows requests with a valid DM cookie', async () => {
    const cookie = `${COOKIE_DM}=${signCookie('1')}`;
    const res = await request(makeApp()).get('/').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
