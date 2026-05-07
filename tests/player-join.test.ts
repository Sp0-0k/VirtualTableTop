import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { verifyCookie } from '../server/src/auth/cookies.js';
import { COOKIE_PLAYER } from '../server/src/auth/constants.js';

function getCookie(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const raw = headers['set-cookie'];
  if (!raw) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  for (const c of arr) {
    const first = c.split(';')[0];
    const [k, v] = first.split('=');
    if (k === name) return v;
  }
  return null;
}

describe('POST /api/player/join', () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startTestServer();
  });

  afterAll(async () => {
    await ts.close();
  });

  it('creates a new player and sets vtt_player_id cookie', async () => {
    const res = await request(ts.server)
      .post('/api/player/join')
      .send({ name: 'Alice', color: '#a1b2c3' });

    expect(res.status).toBe(200);
    expect(res.body.player).toMatchObject({
      name: 'Alice',
      color: '#a1b2c3',
    });
    expect(typeof res.body.player.id).toBe('number');

    const cookieValue = getCookie(res.headers, COOKIE_PLAYER);
    expect(cookieValue).toBeTruthy();
    const verified = verifyCookie(decodeURIComponent(cookieValue!));
    expect(verified).toBe(String(res.body.player.id));
  });

  it('returns the existing row on case-insensitive name re-join', async () => {
    const first = await request(ts.server)
      .post('/api/player/join')
      .send({ name: 'Bob', color: '#abcdef' });
    const firstId = first.body.player.id;

    const second = await request(ts.server)
      .post('/api/player/join')
      .send({ name: 'BOB', color: '#000000' });

    expect(second.status).toBe(200);
    expect(second.body.player.id).toBe(firstId);
    expect(second.body.player.name).toBe('Bob');
    expect(second.body.player.color).toBe('#abcdef');
  });

  it('rejects empty name with 400', async () => {
    const res = await request(ts.server)
      .post('/api/player/join')
      .send({ name: '', color: '#aaaaaa' });
    expect(res.status).toBe(400);
  });

  it('rejects name longer than 20 chars with 400', async () => {
    const res = await request(ts.server)
      .post('/api/player/join')
      .send({ name: 'x'.repeat(21), color: '#aaaaaa' });
    expect(res.status).toBe(400);
  });

  it('rejects malformed color with 400', async () => {
    const res = await request(ts.server)
      .post('/api/player/join')
      .send({ name: 'Carol', color: 'red' });
    expect(res.status).toBe(400);
  });

  it('rejects missing fields with 400', async () => {
    const res = await request(ts.server).post('/api/player/join').send({});
    expect(res.status).toBe(400);
  });
});
