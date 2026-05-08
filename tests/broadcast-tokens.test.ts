import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/src/db/migrate.js';
import { insertAsset } from '../server/src/db/assets.js';
import { createPage, setActivePage } from '../server/src/db/pages.js';
import { createPlayer } from '../server/src/db/players.js';
import { createToken, updateToken } from '../server/src/db/tokens.js';
import { tokenForSocket, type SocketLike, buildFullSync, broadcastTokenEvent } from '../server/src/broadcast.js';
import type { Token } from '../server/src/db/tokens.js';

function dbWithActivePage() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, 'migrations');
  const m = insertAsset(db, {
    hash: 'm', kind: 'map', originalName: 'm.png', mime: 'image/webp',
    width: 4000, height: 3000, sizeBytes: 1,
  });
  const t = insertAsset(db, {
    hash: 't', kind: 'token', originalName: 't.png', mime: 'image/webp',
    width: 256, height: 256, sizeBytes: 1,
  });
  const p = createPage(db, {
    name: 'P', backgroundAssetId: m.id, gridWidthSquares: 20, gridHeightSquares: 15,
  });
  setActivePage(db, p.id);
  return { db, mapAssetId: m.id, tokenAssetId: t.id, pageId: p.id };
}

describe('buildFullSync (M4 extension)', () => {
  it('includes tokens (filtered) for the active page and players list', () => {
    const h = dbWithActivePage();
    const alice = createPlayer(h.db, 'Alice', '#ff0000');
    createToken(h.db, { pageId: h.pageId, assetId: h.tokenAssetId, x: 1, y: 2, name: 'Visible' });
    createToken(h.db, {
      pageId: h.pageId, assetId: h.tokenAssetId, x: 3, y: 4, name: 'Hidden',
    });
    const all = h.db.prepare('SELECT id FROM tokens').all() as { id: number }[];
    updateToken(h.db, all[1].id, { hidden: 1 });

    const dmSync = buildFullSync(h.db, { data: { role: 'dm', name: 'DM', playerId: null } });
    expect(dmSync.tokens).toHaveLength(2);
    expect(dmSync.players).toEqual([
      { id: alice.id, name: 'Alice', color: '#ff0000' },
    ]);

    const playerSync = buildFullSync(h.db, {
      data: { role: 'player', name: 'Alice', playerId: alice.id },
    });
    expect(playerSync.tokens).toHaveLength(1);
    expect(playerSync.tokens[0].name).toBe('Visible');
    h.db.close();
  });

  it('returns empty tokens when no page is active', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, 'migrations');
    const sync = buildFullSync(db, { data: { role: 'dm', name: 'DM', playerId: null } });
    expect(sync.activePage).toBeNull();
    expect(sync.tokens).toEqual([]);
    expect(sync.players).toEqual([]);
    db.close();
  });
});

describe('broadcastTokenEvent', () => {
  it('emits filtered payload to each connected socket; null filter triggers token:deleted on update', () => {
    const h = dbWithActivePage();
    const tok = createToken(h.db, {
      pageId: h.pageId, assetId: h.tokenAssetId, x: 0, y: 0, name: 'X',
    });
    const hidden = updateToken(h.db, tok.id, { hidden: 1 });
    const emits: { sid: string; event: string; payload: unknown }[] = [];
    const fakeIo = {
      sockets: {
        sockets: new Map<string, FakeSocket>([
          ['dm1', new FakeSocket('dm1', 'dm', null, emits)],
          ['p1',  new FakeSocket('p1',  'player', 7, emits)],
        ]),
      },
    };
    broadcastTokenEvent(fakeIo as never, h.db, 'token:updated', hidden);
    const dmEmits = emits.filter((e) => e.sid === 'dm1');
    const pEmits  = emits.filter((e) => e.sid === 'p1');
    expect(dmEmits).toHaveLength(1);
    expect(dmEmits[0].event).toBe('token:updated');
    expect(pEmits).toHaveLength(1);
    expect(pEmits[0].event).toBe('token:deleted');
    expect(pEmits[0].payload).toEqual({ id: tok.id, page_id: h.pageId });
    h.db.close();
  });
});

class FakeSocket {
  data: { role: 'dm' | 'player'; name: string; playerId: number | null };
  constructor(
    public id: string,
    role: 'dm' | 'player',
    playerId: number | null,
    private sink: { sid: string; event: string; payload: unknown }[],
  ) {
    this.data = { role, name: role === 'dm' ? 'DM' : 'P', playerId };
  }
  emit(event: string, payload: unknown) {
    this.sink.push({ sid: this.id, event, payload });
  }
}

const baseToken: Token = {
  id: 1, pageId: 1, assetId: 1, name: 'Goblin',
  x: 0, y: 0, sizeSquares: 1, ownerPlayerId: null,
  hidden: 0, currentHp: 5, maxHp: 10,
  conditions: ['poisoned'], hpVisibleToPlayers: 1, zIndex: 0,
};

const dmSocket: SocketLike = { data: { role: 'dm', name: 'DM', playerId: null } };
const playerSocket: SocketLike = { data: { role: 'player', name: 'Alice', playerId: 7 } };

describe('tokenForSocket', () => {
  it('returns full record for DM', () => {
    const out = tokenForSocket(baseToken, dmSocket, '/assets/h.webp', '/assets/h.thumb.webp');
    expect(out).not.toBeNull();
    expect(out!.hidden).toBe(0);
    expect(out!.current_hp).toBe(5);
    expect(out!.hp_visible_to_players).toBe(1);
  });

  it('returns null for player when token is hidden', () => {
    expect(
      tokenForSocket(
        { ...baseToken, hidden: 1 },
        playerSocket,
        '/assets/h.webp',
        '/assets/h.thumb.webp',
      ),
    ).toBeNull();
  });

  it('strips HP fields when hpVisibleToPlayers=0 for player', () => {
    const out = tokenForSocket(
      { ...baseToken, hpVisibleToPlayers: 0 },
      playerSocket,
      '/assets/h.webp',
      '/assets/h.thumb.webp',
    );
    expect(out).not.toBeNull();
    expect(out!.current_hp).toBeUndefined();
    expect(out!.max_hp).toBeUndefined();
  });

  it('returns full HP for player when hpVisibleToPlayers=1', () => {
    const out = tokenForSocket(baseToken, playerSocket, '/assets/h.webp', '/assets/h.thumb.webp');
    expect(out!.current_hp).toBe(5);
    expect(out!.max_hp).toBe(10);
  });

  it('omits DM-only meta fields from player payload', () => {
    const out = tokenForSocket(baseToken, playerSocket, '/assets/h.webp', '/assets/h.thumb.webp');
    expect(out!.hidden).toBeUndefined();
    expect(out!.hp_visible_to_players).toBeUndefined();
  });
});
