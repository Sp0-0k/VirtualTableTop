import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/src/db/migrate.js';
import { insertAsset } from '../server/src/db/assets.js';
import { createPage } from '../server/src/db/pages.js';
import { createPlayer } from '../server/src/db/players.js';
import {
  createToken,
  deleteToken,
  findTokenById,
  listTokensByPage,
  TokenError,
  updateToken,
  updateTokenXY,
} from '../server/src/db/tokens.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, 'migrations');
  const a = insertAsset(db, {
    hash: 'h_token', kind: 'token', originalName: 't.png', mime: 'image/webp',
    width: 256, height: 256, sizeBytes: 1,
  });
  const m = insertAsset(db, {
    hash: 'h_map', kind: 'map', originalName: 'm.png', mime: 'image/webp',
    width: 4096, height: 3072, sizeBytes: 1,
  });
  const p = createPage(db, {
    name: 'P', backgroundAssetId: m.id, gridWidthSquares: 20, gridHeightSquares: 15,
  });
  return { db, tokenAssetId: a.id, mapAssetId: m.id, pageId: p.id };
}

describe('db/tokens', () => {
  let h: ReturnType<typeof freshDb>;
  beforeEach(() => { h = freshDb(); });
  afterEach(() => h.db.close());

  it('createToken inserts with defaults', () => {
    const t = createToken(h.db, {
      pageId: h.pageId, assetId: h.tokenAssetId, x: 100, y: 200,
    });
    expect(t.id).toBeGreaterThan(0);
    expect(t.x).toBe(100);
    expect(t.y).toBe(200);
    expect(t.sizeSquares).toBe(1);
    expect(t.hidden).toBe(0);
    expect(t.hpVisibleToPlayers).toBe(1);
    expect(t.conditions).toEqual([]);
    expect(t.zIndex).toBe(0);
    expect(t.ownerPlayerId).toBeNull();
  });

  it('findTokenById round-trips', () => {
    const t = createToken(h.db, { pageId: h.pageId, assetId: h.tokenAssetId, x: 0, y: 0 });
    expect(findTokenById(h.db, t.id)).toEqual(t);
    expect(findTokenById(h.db, 999)).toBeNull();
  });

  it('listTokensByPage returns only that page sorted', () => {
    const m2 = insertAsset(h.db, {
      hash: 'h_map2', kind: 'map', originalName: 'm.png', mime: 'image/webp',
      width: 4096, height: 3072, sizeBytes: 1,
    });
    const otherPage = createPage(h.db, {
      name: 'P2', backgroundAssetId: m2.id, gridWidthSquares: 10, gridHeightSquares: 10,
    });
    createToken(h.db, { pageId: h.pageId, assetId: h.tokenAssetId, x: 0, y: 0 });
    createToken(h.db, { pageId: otherPage.id, assetId: h.tokenAssetId, x: 0, y: 0 });
    const here = listTokensByPage(h.db, h.pageId);
    expect(here).toHaveLength(1);
    expect(here[0].pageId).toBe(h.pageId);
  });

  it('updateToken patches only provided fields and parses conditions JSON', () => {
    const t = createToken(h.db, { pageId: h.pageId, assetId: h.tokenAssetId, x: 0, y: 0 });
    const u = updateToken(h.db, t.id, {
      name: 'Goblin', hidden: 1, currentHp: 7, maxHp: 10,
      conditions: ['poisoned', 'prone'], hpVisibleToPlayers: 0,
    });
    expect(u.name).toBe('Goblin');
    expect(u.hidden).toBe(1);
    expect(u.currentHp).toBe(7);
    expect(u.maxHp).toBe(10);
    expect(u.conditions).toEqual(['poisoned', 'prone']);
    expect(u.hpVisibleToPlayers).toBe(0);
    expect(u.x).toBe(0); // untouched
  });

  it('updateToken sets owner_player_id to null when explicitly null', () => {
    const player = createPlayer(h.db, 'Alice', '#ff0000');
    const t = createToken(h.db, {
      pageId: h.pageId, assetId: h.tokenAssetId, x: 0, y: 0,
      ownerPlayerId: player.id,
    });
    const u = updateToken(h.db, t.id, { ownerPlayerId: null });
    expect(u.ownerPlayerId).toBeNull();
  });

  it('updateToken throws TokenError NOT_FOUND for unknown id', () => {
    expect(() => updateToken(h.db, 999, { name: 'x' })).toThrow(TokenError);
  });

  it('updateTokenXY mutates only x/y/updated_at', () => {
    const t = createToken(h.db, { pageId: h.pageId, assetId: h.tokenAssetId, x: 0, y: 0 });
    const moved = updateTokenXY(h.db, t.id, 50.5, 75.25);
    expect(moved.x).toBe(50.5);
    expect(moved.y).toBe(75.25);
    expect(moved.id).toBe(t.id);
  });

  it('deleteToken removes the row', () => {
    const t = createToken(h.db, { pageId: h.pageId, assetId: h.tokenAssetId, x: 0, y: 0 });
    deleteToken(h.db, t.id);
    expect(findTokenById(h.db, t.id)).toBeNull();
  });

  it('deleteToken throws NOT_FOUND for missing id', () => {
    expect(() => deleteToken(h.db, 999)).toThrow(TokenError);
  });

  it('rejects createToken when assetId is a map', () => {
    expect(() =>
      createToken(h.db, { pageId: h.pageId, assetId: h.mapAssetId, x: 0, y: 0 }),
    ).toThrow(TokenError);
  });
});
