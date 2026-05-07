import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { verifyCookie } from '../server/src/auth/cookies.js';
import { COOKIE_DM } from '../server/src/auth/constants.js';

function extractCookie(setCookieHeader: string | string[] | undefined, name: string): string | null {
  if (!setCookieHeader) return null;
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const raw of arr) {
    const first = raw.split(';')[0];
    const [k, v] = first.split('=');
    if (k === name) return v;
  }
  return null;
}

describe('GET /api/dm/bootstrap', () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startTestServer();
  });

  afterAll(async () => {
    await ts.close();
  });

  it('returns { ok: true }', async () => {
    const res = await request(ts.server).get('/api/dm/bootstrap');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('sets a signed vtt_dm cookie with HttpOnly + SameSite=Lax', async () => {
    const res = await request(ts.server).get('/api/dm/bootstrap');
    const setCookie = res.headers['set-cookie'];
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookie).toMatch(new RegExp(`^${COOKIE_DM}=`));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);

    const value = extractCookie(setCookie, COOKIE_DM);
    expect(value).toBeTruthy();
    expect(verifyCookie(decodeURIComponent(value!))).toBe('1');
  });
});
