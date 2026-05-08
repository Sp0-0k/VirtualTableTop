import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { insertAsset } from '../server/src/db/assets.js';
import { createPage, setActivePage } from '../server/src/db/pages.js';
import { createToken, findTokenById } from '../server/src/db/tokens.js';
import { createPlayer } from '../server/src/db/players.js';
import { signCookie } from '../server/src/auth/cookies.js';

async function dmCookie(ts: TestServer): Promise<string> {
  const r = await request(ts.server).get('/api/dm/bootstrap');
  return (r.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
}

function playerCookieFor(playerId: number): string {
  return `vtt_player_id=${encodeURIComponent(signCookie(String(playerId)))}`;
}

// Buffered events — pre-registers listeners before connect so events aren't missed
const buffered = new WeakMap<ClientSocket, Map<string, unknown[]>>();

function connect(url: string, cookie: string): Promise<ClientSocket> {
  return new Promise((res, rej) => {
    const c = ioc(url, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false });
    const buf = new Map<string, unknown[]>();
    buffered.set(c, buf);
    // Pre-register common server-push events so they aren't missed in the gap
    // between connect() resolving and nextEvent() being called
    for (const ev of ['state:full_sync', 'session', 'token:moved', 'token:moving', 'error']) {
      c.on(ev, (p: unknown) => {
        const arr = buf.get(ev) ?? [];
        arr.push(p);
        buf.set(ev, arr);
      });
    }
    const t = setTimeout(() => { c.close(); rej(new Error('timeout')); }, 2000);
    c.on('connect', () => { clearTimeout(t); res(c); });
    c.on('connect_error', (e) => { clearTimeout(t); rej(e); });
  });
}

function nextEvent<T>(s: ClientSocket, event: string, ms = 1000): Promise<T> {
  const buf = buffered.get(s);
  const arr = buf?.get(event);
  if (arr && arr.length > 0) {
    const payload = arr.shift() as T;
    return Promise.resolve(payload);
  }
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for ${event}`)), ms);
    s.once(event, (p: T) => { clearTimeout(t); res(p); });
  });
}

function neverEvent<T>(s: ClientSocket, event: string, ms = 200): Promise<T | null> {
  const buf = buffered.get(s);
  const arr = buf?.get(event);
  if (arr && arr.length > 0) {
    const payload = arr.shift() as T;
    return Promise.resolve(payload);
  }
  return new Promise((res) => {
    const t = setTimeout(() => res(null), ms);
    s.once(event, (p: T) => { clearTimeout(t); res(p); });
  });
}

async function setupActivePage(ts: TestServer): Promise<{ pageId: number; tokenAssetId: number }> {
  const m = insertAsset(ts.db, {
    hash: 'm', kind: 'map', originalName: 'm.png', mime: 'image/webp',
    width: 4000, height: 3000, sizeBytes: 1,
  });
  const t = insertAsset(ts.db, {
    hash: 't', kind: 'token', originalName: 't.png', mime: 'image/webp',
    width: 256, height: 256, sizeBytes: 1,
  });
  const p = createPage(ts.db, { name: 'P', backgroundAssetId: m.id, gridWidthSquares: 20, gridHeightSquares: 15 });
  setActivePage(ts.db, p.id);
  return { pageId: p.id, tokenAssetId: t.id };
}

describe('socket token:move_*', () => {
  let ts: TestServer;
  beforeEach(async () => { ts = await startTestServer(); });
  afterEach(async () => { await ts.close(); });

  it('DM move_commit persists to DB and broadcasts token:moved to all', async () => {
    const { pageId, tokenAssetId } = await setupActivePage(ts);
    const tok = createToken(ts.db, { pageId, assetId: tokenAssetId, x: 0, y: 0, name: 'X' });
    const alice = createPlayer(ts.db, 'Alice', '#ff0000');
    const dmSock = await connect(ts.url, await dmCookie(ts));
    const playerSock = await connect(ts.url, playerCookieFor(alice.id));
    await nextEvent(dmSock, 'state:full_sync');
    await nextEvent(playerSock, 'state:full_sync');

    const dmMoved = nextEvent<{ id: number; x: number; y: number }>(dmSock, 'token:moved');
    const pMoved = nextEvent<{ id: number; x: number; y: number }>(playerSock, 'token:moved');
    dmSock.emit('token:move_commit', { id: tok.id, x: 100, y: 50 });
    expect(await dmMoved).toMatchObject({ id: tok.id, x: 100, y: 50 });
    expect(await pMoved).toMatchObject({ id: tok.id, x: 100, y: 50 });
    expect(findTokenById(ts.db, tok.id)).toMatchObject({ x: 100, y: 50 });

    dmSock.close(); playerSock.close();
  });

  it('player can only move their own token', async () => {
    const { pageId, tokenAssetId } = await setupActivePage(ts);
    const alice = createPlayer(ts.db, 'Alice', '#ff0000');
    const bob   = createPlayer(ts.db, 'Bob',   '#0000ff');
    const aliceTok = createToken(ts.db, {
      pageId, assetId: tokenAssetId, x: 0, y: 0, name: 'A', ownerPlayerId: alice.id,
    });
    const bobTok = createToken(ts.db, {
      pageId, assetId: tokenAssetId, x: 0, y: 0, name: 'B', ownerPlayerId: bob.id,
    });

    const aliceSock = await connect(ts.url, playerCookieFor(alice.id));
    const dmSock = await connect(ts.url, await dmCookie(ts));
    await nextEvent(aliceSock, 'state:full_sync');
    await nextEvent(dmSock, 'state:full_sync');

    const ok = nextEvent<{ id: number }>(aliceSock, 'token:moved');
    aliceSock.emit('token:move_commit', { id: aliceTok.id, x: 9, y: 9 });
    expect(await ok).toMatchObject({ id: aliceTok.id });

    const err = nextEvent<{ code: string }>(aliceSock, 'error');
    aliceSock.emit('token:move_commit', { id: bobTok.id, x: 7, y: 7 });
    expect((await err).code).toBe('forbidden');
    expect(findTokenById(ts.db, bobTok.id)).toMatchObject({ x: 0, y: 0 });

    aliceSock.close(); dmSock.close();
  });

  it('move_preview broadcasts token:moving to others, not the mover, no DB write', async () => {
    const { pageId, tokenAssetId } = await setupActivePage(ts);
    const tok = createToken(ts.db, { pageId, assetId: tokenAssetId, x: 0, y: 0 });
    const alice = createPlayer(ts.db, 'Alice', '#ff0000');
    const dmSock = await connect(ts.url, await dmCookie(ts));
    const aliceSock = await connect(ts.url, playerCookieFor(alice.id));
    await nextEvent(dmSock, 'state:full_sync');
    await nextEvent(aliceSock, 'state:full_sync');

    const aliceMoving = nextEvent<{ x: number; y: number }>(aliceSock, 'token:moving');
    const dmMoving = neverEvent<unknown>(dmSock, 'token:moving', 200);
    dmSock.emit('token:move_preview', { id: tok.id, x: 42, y: 42 });
    expect(await aliceMoving).toMatchObject({ x: 42, y: 42 });
    expect(await dmMoving).toBeNull();
    expect(findTokenById(ts.db, tok.id)).toMatchObject({ x: 0, y: 0 });

    dmSock.close(); aliceSock.close();
  });
});
