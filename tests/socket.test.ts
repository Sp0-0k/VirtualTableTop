import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
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

function connect(url: string, cookie?: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioc(url, {
      transports: ['websocket'],
      extraHeaders: cookie ? { Cookie: cookie } : {},
      reconnection: false,
    });
    const timer = setTimeout(() => {
      client.close();
      reject(new Error('connect timeout'));
    }, 2000);
    client.on('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

interface SessionPayload {
  role: string;
  name: string;
  playerId: number | null;
}

function connectAndAwaitSession(
  url: string,
  cookie: string,
): Promise<{ client: ClientSocket; session: SessionPayload }> {
  return new Promise((resolve, reject) => {
    const client = ioc(url, {
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
    });
    const timer = setTimeout(() => {
      client.close();
      reject(new Error('connect/session timeout'));
    }, 2000);
    client.on('session', (session: SessionPayload) => {
      clearTimeout(timer);
      resolve({ client, session });
    });
    client.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('Socket.IO auth handshake', () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startTestServer();
  });

  afterAll(async () => {
    await ts.close();
  });

  it('rejects connections without a cookie', async () => {
    await expect(connect(ts.url)).rejects.toThrow(/not authenticated/i);
  });

  it('rejects connections with a tampered cookie', async () => {
    await expect(connect(ts.url, 'vtt_dm=1.deadbeef')).rejects.toThrow(/not authenticated/i);
  });

  it('accepts a DM connection and emits session info', async () => {
    const cookie = await bootstrapDm(ts);
    const { client, session } = await connectAndAwaitSession(ts.url, cookie);
    expect(session.role).toBe('dm');
    expect(session.name).toBe('DM');
    client.close();
  });

  it('accepts a player connection and emits session info with player data', async () => {
    const cookie = await joinAsPlayer(ts, 'Riley', '#112233');
    const { client, session } = await connectAndAwaitSession(ts.url, cookie);
    expect(session.role).toBe('player');
    expect(session.name).toBe('Riley');
    expect(typeof session.playerId).toBe('number');
    client.close();
  });

  it('rejects a player cookie whose id no longer exists', async () => {
    const { signCookie } = await import('../server/src/auth/cookies.js');
    const fakeCookie = `vtt_player_id=${encodeURIComponent(signCookie('99999'))}`;
    await expect(connect(ts.url, fakeCookie)).rejects.toThrow(/not authenticated/i);
  });
});
