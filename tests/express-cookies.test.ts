import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  setSignedCookie,
  readSignedCookie,
} from '../server/src/auth/express-cookies.js';

function makeApp() {
  const app = express();
  app.get('/set', (_req, res) => {
    setSignedCookie(res, 'vtt_test', 'abc', { maxAgeSeconds: 60 });
    res.json({ ok: true });
  });
  app.get('/read', (req, res) => {
    res.json({ value: readSignedCookie(req, 'vtt_test') });
  });
  return app;
}

describe('signed cookie express helpers', () => {
  it('round-trips a value via Set-Cookie + Cookie header', async () => {
    const app = makeApp();
    const setRes = await request(app).get('/set');
    expect(setRes.status).toBe(200);
    const setCookie = setRes.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieHeader = (Array.isArray(setCookie) ? setCookie : [setCookie])
      .map((c: string) => c.split(';')[0])
      .join('; ');

    const readRes = await request(app).get('/read').set('Cookie', cookieHeader);
    expect(readRes.body).toEqual({ value: 'abc' });
  });

  it('returns null for a missing cookie', async () => {
    const app = makeApp();
    const res = await request(app).get('/read');
    expect(res.body).toEqual({ value: null });
  });

  it('returns null for a tampered cookie', async () => {
    const res = await request(makeApp())
      .get('/read')
      .set('Cookie', 'vtt_test=tampered.deadbeef');
    expect(res.body).toEqual({ value: null });
  });

  it('Set-Cookie has HttpOnly, SameSite=Lax, Path=/', async () => {
    const setRes = await request(makeApp()).get('/set');
    const raw = setRes.headers['set-cookie']!;
    const cookie = (Array.isArray(raw) ? raw[0] : raw) as string;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=60(;|$)/);
    expect(cookie).not.toMatch(/Domain=/);
  });

  it('Set-Cookie does NOT include Secure when COOKIE_SECURE is unset', async () => {
    const setRes = await request(makeApp()).get('/set');
    const raw = setRes.headers['set-cookie']!;
    const cookie = (Array.isArray(raw) ? raw[0] : raw) as string;
    expect(cookie).not.toMatch(/Secure/);
  });

  it('Set-Cookie includes Secure when COOKIE_SECURE=1', async () => {
    const original = process.env.COOKIE_SECURE;
    process.env.COOKIE_SECURE = '1';
    try {
      const setRes = await request(makeApp()).get('/set');
      const raw = setRes.headers['set-cookie']!;
      const cookie = (Array.isArray(raw) ? raw[0] : raw) as string;
      expect(cookie).toMatch(/Secure/);
    } finally {
      if (original === undefined) delete process.env.COOKIE_SECURE;
      else process.env.COOKIE_SECURE = original;
    }
  });
});
