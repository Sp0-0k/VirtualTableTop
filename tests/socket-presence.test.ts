import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { startTestServer, type TestServer } from './helpers/testServer.js';

async function joinAsPlayer(
  ts: TestServer,
  name: string,
  color: string,
): Promise<{ cookie: string; id: number }> {
  const res = await request(ts.server).post('/api/player/join').send({ name, color });
  const setCookie = res.headers['set-cookie'];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie!];
  const cookie = arr.map((c: string) => c.split(';')[0]).join('; ');
  return { cookie, id: res.body.player.id };
}

async function bootstrapDm(ts: TestServer): Promise<string> {
  const res = await request(ts.server).get('/api/dm/bootstrap');
  const setCookie = res.headers['set-cookie'];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie!];
  return arr.map((c: string) => c.split(';')[0]).join('; ');
}

function connectWithCookie(url: string, cookie: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const c = ioc(url, {
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
    });
    const t = setTimeout(() => {
      c.close();
      reject(new Error('connect timeout'));
    }, 2000);
    c.on('connect', () => {
      clearTimeout(t);
      resolve(c);
    });
    c.on('connect_error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

function waitForEvent<T>(sock: ClientSocket, event: string, timeoutMs = 1500): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    sock.once(event, (p: T) => {
      clearTimeout(t);
      resolve(p);
    });
  });
}

describe('presence broadcasts', () => {
  let ts: TestServer;
  beforeAll(async () => {
    ts = await startTestServer();
  });
  afterAll(async () => {
    await ts.close();
  });

  it('emits player:joined when a player connects for the first time', async () => {
    const dmCookie = await bootstrapDm(ts);
    const { cookie: pCookie, id: pId } = await joinAsPlayer(ts, 'Ari', '#abcdef');

    const dm = await connectWithCookie(ts.url, dmCookie);
    const joined = waitForEvent<{ playerId: number }>(dm, 'player:joined');
    const player = await connectWithCookie(ts.url, pCookie);
    await expect(joined).resolves.toEqual({ playerId: pId });

    dm.close();
    player.close();
  });

  it('does NOT emit player:joined for a second tab of the same player', async () => {
    const dmCookie = await bootstrapDm(ts);
    const { cookie: pCookie } = await joinAsPlayer(ts, 'Bri', '#abcdef');

    const player1 = await connectWithCookie(ts.url, pCookie);
    const dm = await connectWithCookie(ts.url, dmCookie);
    let secondJoinSeen = false;
    dm.on('player:joined', () => {
      secondJoinSeen = true;
    });
    const player2 = await connectWithCookie(ts.url, pCookie);

    await new Promise((r) => setTimeout(r, 200));
    expect(secondJoinSeen).toBe(false);

    player1.close();
    player2.close();
    dm.close();
  });

  it('emits player:left only when the last socket for a player disconnects', async () => {
    const dmCookie = await bootstrapDm(ts);
    const { cookie: pCookie, id: pId } = await joinAsPlayer(ts, 'Cas', '#abcdef');

    const player1 = await connectWithCookie(ts.url, pCookie);
    const player2 = await connectWithCookie(ts.url, pCookie);
    const dm = await connectWithCookie(ts.url, dmCookie);

    let leftSeen: { playerId: number } | null = null;
    dm.on('player:left', (p: { playerId: number }) => {
      leftSeen = p;
    });

    player1.close();
    await new Promise((r) => setTimeout(r, 200));
    expect(leftSeen).toBeNull();

    player2.close();
    await new Promise((r) => setTimeout(r, 200));
    expect(leftSeen).toEqual({ playerId: pId });

    dm.close();
  });

  it('DM connecting/disconnecting does not emit presence events', async () => {
    const dmCookie1 = await bootstrapDm(ts);
    const { cookie: pCookie } = await joinAsPlayer(ts, 'Dru', '#abcdef');

    const observer = await connectWithCookie(ts.url, pCookie);
    let sawJoin = false;
    let sawLeft = false;
    observer.on('player:joined', () => {
      sawJoin = true;
    });
    observer.on('player:left', () => {
      sawLeft = true;
    });

    const dmCookie2 = await bootstrapDm(ts);
    const dm = await connectWithCookie(ts.url, dmCookie2);
    await new Promise((r) => setTimeout(r, 100));
    dm.close();
    await new Promise((r) => setTimeout(r, 200));

    expect(sawJoin).toBe(false);
    expect(sawLeft).toBe(false);

    observer.close();
    void dmCookie1;
  });
});
