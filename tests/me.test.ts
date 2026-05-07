import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, type TestServer } from './helpers/testServer.js';

async function joinAsPlayer(ts: TestServer, name: string, color: string): Promise<string> {
  const res = await request(ts.server).post('/api/player/join').send({ name, color });
  const setCookie = res.headers['set-cookie'];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie!];
  return arr.map((c: string) => c.split(';')[0]).join('; ');
}

async function bootstrapDm(ts: TestServer): Promise<string> {
  const res = await request(ts.server).get('/api/dm/bootstrap');
  const setCookie = res.headers['set-cookie'];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie!];
  return arr.map((c: string) => c.split(';')[0]).join('; ');
}

describe('GET /api/me', () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startTestServer();
  });

  afterAll(async () => {
    await ts.close();
  });

  it('returns role=anon when no cookies are present', async () => {
    const res = await request(ts.server).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ role: 'anon' });
  });

  it('returns role=player with the player record when vtt_player_id is set', async () => {
    const cookie = await joinAsPlayer(ts, 'Pia', '#445566');
    const res = await request(ts.server).get('/api/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('player');
    expect(res.body.player).toMatchObject({ name: 'Pia', color: '#445566' });
  });

  it('returns role=dm when vtt_dm cookie is set', async () => {
    const cookie = await bootstrapDm(ts);
    const res = await request(ts.server).get('/api/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ role: 'dm' });
  });

  it('prefers DM role when both cookies are present', async () => {
    const playerCookie = await joinAsPlayer(ts, 'Quincy', '#778899');
    const dmCookie = await bootstrapDm(ts);
    const combined = `${playerCookie}; ${dmCookie}`;
    const res = await request(ts.server).get('/api/me').set('Cookie', combined);
    expect(res.body).toEqual({ role: 'dm' });
  });

  it('returns role=anon when player cookie is signed but the id no longer exists', async () => {
    const { signCookie } = await import('../server/src/auth/cookies.js');
    const fakeCookie = `vtt_player_id=${encodeURIComponent(signCookie('99999'))}`;
    const res = await request(ts.server).get('/api/me').set('Cookie', fakeCookie);
    expect(res.body).toEqual({ role: 'anon' });
  });
});
