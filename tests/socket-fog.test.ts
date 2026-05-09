import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { insertAsset } from '../server/src/db/assets.js';
import { createPage, setActivePage } from '../server/src/db/pages.js';
import { createPlayer } from '../server/src/db/players.js';
import { listFogStrokesByPage } from '../server/src/db/fog-strokes.js';
import { signCookie } from '../server/src/auth/cookies.js';

async function dmCookie(ts: TestServer): Promise<string> {
  const r = await request(ts.server).get('/api/dm/bootstrap');
  return (r.headers['set-cookie'] as unknown as string[])
    .map((c) => c.split(';')[0]).join('; ');
}

function playerCookieFor(playerId: number): string {
  return `vtt_player_id=${encodeURIComponent(signCookie(String(playerId)))}`;
}

const buffered = new WeakMap<ClientSocket, Map<string, unknown[]>>();

function connect(url: string, cookie: string): Promise<ClientSocket> {
  return new Promise((res, rej) => {
    const c = ioc(url, {
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
    });
    const buf = new Map<string, unknown[]>();
    buffered.set(c, buf);
    for (const ev of [
      'state:full_sync', 'session', 'error',
      'fog:stroking', 'fog:stroke_added', 'fog:cleared',
    ]) {
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
  if (arr && arr.length > 0) return Promise.resolve(arr.shift() as T);
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for ${event}`)), ms);
    s.once(event, (p: T) => { clearTimeout(t); res(p); });
  });
}

function neverEvent<T>(s: ClientSocket, event: string, ms = 200): Promise<T | null> {
  const buf = buffered.get(s);
  const arr = buf?.get(event);
  if (arr && arr.length > 0) return Promise.resolve(arr.shift() as T);
  return new Promise((res) => {
    const t = setTimeout(() => res(null), ms);
    s.once(event, (p: T) => { clearTimeout(t); res(p); });
  });
}

async function setupActivePage(ts: TestServer) {
  const m = insertAsset(ts.db, {
    hash: 'm', kind: 'map', originalName: 'm.png', mime: 'image/webp',
    width: 1000, height: 800, sizeBytes: 1,
  });
  const active = createPage(ts.db, {
    name: 'A', backgroundAssetId: m.id, gridWidthSquares: 10, gridHeightSquares: 8,
  });
  const inactive = createPage(ts.db, {
    name: 'B', backgroundAssetId: m.id, gridWidthSquares: 10, gridHeightSquares: 8,
  });
  setActivePage(ts.db, active.id);
  return { activeId: active.id, inactiveId: inactive.id };
}

describe('socket fog:*', () => {
  let ts: TestServer;
  beforeEach(async () => { ts = await startTestServer(); });
  afterEach(async () => { await ts.close(); });

  it('DM stroke_commit on active page persists and broadcasts to player', async () => {
    const { activeId } = await setupActivePage(ts);
    const alice = createPlayer(ts.db, 'Alice', '#f00');
    const dm = await connect(ts.url, await dmCookie(ts));
    const player = await connect(ts.url, playerCookieFor(alice.id));
    await nextEvent(dm, 'state:full_sync');
    await nextEvent(player, 'state:full_sync');

    const dmAdded = nextEvent<{ stroke: { id: number; mode: string } }>(dm, 'fog:stroke_added');
    const pAdded = nextEvent<{ stroke: { id: number; mode: string } }>(player, 'fog:stroke_added');
    dm.emit('fog:stroke_commit', {
      pageId: activeId, mode: 'reveal', shape: 'brush',
      points: [[10, 10], [20, 20]], radius: 25,
    });
    expect((await dmAdded).stroke.mode).toBe('reveal');
    expect((await pAdded).stroke.mode).toBe('reveal');
    expect(listFogStrokesByPage(ts.db, activeId)).toHaveLength(1);
    dm.close(); player.close();
  });

  it('DM stroke_commit on non-active page broadcasts to other DMs only', async () => {
    const { activeId, inactiveId } = await setupActivePage(ts);
    const alice = createPlayer(ts.db, 'Alice', '#f00');
    const dm1 = await connect(ts.url, await dmCookie(ts));
    const dm2 = await connect(ts.url, await dmCookie(ts));
    const player = await connect(ts.url, playerCookieFor(alice.id));
    await Promise.all([
      nextEvent(dm1, 'state:full_sync'),
      nextEvent(dm2, 'state:full_sync'),
      nextEvent(player, 'state:full_sync'),
    ]);

    const dm2Added = nextEvent<{ stroke: { id: number } }>(dm2, 'fog:stroke_added');
    const playerNo = neverEvent(player, 'fog:stroke_added', 250);
    dm1.emit('fog:stroke_commit', {
      pageId: inactiveId, mode: 'reveal', shape: 'brush',
      points: [[1, 1]], radius: 10,
    });
    expect(await dm2Added).toBeTruthy();
    expect(await playerNo).toBeNull();
    expect(activeId).not.toBe(inactiveId);
    dm1.close(); dm2.close(); player.close();
  });

  it('DM stroke_preview broadcasts fog:stroking only to other DMs', async () => {
    const { activeId } = await setupActivePage(ts);
    const alice = createPlayer(ts.db, 'Alice', '#f00');
    const dm1 = await connect(ts.url, await dmCookie(ts));
    const dm2 = await connect(ts.url, await dmCookie(ts));
    const player = await connect(ts.url, playerCookieFor(alice.id));
    await Promise.all([
      nextEvent(dm1, 'state:full_sync'),
      nextEvent(dm2, 'state:full_sync'),
      nextEvent(player, 'state:full_sync'),
    ]);

    const dm2Stroking = nextEvent(dm2, 'fog:stroking');
    const playerNo = neverEvent(player, 'fog:stroking', 250);
    const dm1Self = neverEvent(dm1, 'fog:stroking', 250);
    dm1.emit('fog:stroke_preview', {
      pageId: activeId, mode: 'reveal', shape: 'brush',
      points: [[1, 1], [2, 2]], radius: 10,
    });
    expect(await dm2Stroking).toBeTruthy();
    expect(await playerNo).toBeNull();
    expect(await dm1Self).toBeNull();
    dm1.close(); dm2.close(); player.close();
  });

  it('player fog:stroke_commit is rejected', async () => {
    const { activeId } = await setupActivePage(ts);
    const alice = createPlayer(ts.db, 'Alice', '#f00');
    const player = await connect(ts.url, playerCookieFor(alice.id));
    await nextEvent(player, 'state:full_sync');

    const err = nextEvent<{ code: string }>(player, 'error');
    player.emit('fog:stroke_commit', {
      pageId: activeId, mode: 'reveal', shape: 'brush',
      points: [[1, 1]], radius: 10,
    });
    expect((await err).code).toBe('forbidden');
    expect(listFogStrokesByPage(ts.db, activeId)).toEqual([]);
    player.close();
  });

  it('invalid stroke is rejected with error and no row created', async () => {
    const { activeId } = await setupActivePage(ts);
    const dm = await connect(ts.url, await dmCookie(ts));
    await nextEvent(dm, 'state:full_sync');

    const err = nextEvent<{ code: string }>(dm, 'error');
    dm.emit('fog:stroke_commit', {
      pageId: activeId, mode: 'reveal', shape: 'rect',
      points: [[100, 100], [100, 100]], radius: 0,  // zero-area
    });
    expect((await err).code).toBe('bad_payload');
    expect(listFogStrokesByPage(ts.db, activeId)).toEqual([]);
    dm.close();
  });
});
