import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/src/db/migrate.js';
import { insertAsset } from '../server/src/db/assets.js';
import { createPage, setActivePage } from '../server/src/db/pages.js';
import { buildFullSync, resolvePageWithUrl } from '../server/src/broadcast.js';
import { createPresence } from '../server/src/presence.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, 'migrations');
  return db;
}

describe('broadcast helpers', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('resolvePageWithUrl returns null background_url when asset is missing', () => {
    const page = createPage(db, {
      name: 'A',
      backgroundAssetId: null,
      gridWidthSquares: 20,
      gridHeightSquares: 15,
    });
    const resolved = resolvePageWithUrl(db, page);
    expect(resolved.background_url).toBeNull();
    expect(resolved.background_asset_id).toBeNull();
    expect(resolved.id).toBe(page.id);
  });

  it('resolvePageWithUrl builds /assets/<hash>.webp when present', () => {
    const a = insertAsset(db, {
      hash: 'abc123',
      kind: 'map',
      originalName: 'm.png',
      mime: 'image/webp',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });
    const page = createPage(db, {
      name: 'A',
      backgroundAssetId: a.id,
      gridWidthSquares: 20,
      gridHeightSquares: 15,
    });
    const resolved = resolvePageWithUrl(db, page);
    expect(resolved.background_url).toBe('/assets/abc123.webp');
  });

  it('buildFullSync returns { activePage: null } when nothing is active', () => {
    const dmSocket = { data: { role: 'dm' as const, name: 'DM' as const, playerId: null } };
    const sync = buildFullSync(db, dmSocket, createPresence());
    expect(sync.activePage).toBeNull();
    expect(sync.tokens).toEqual([]);
    expect(sync.players).toEqual([]);
    expect(sync.online_player_ids).toEqual([]);
  });

  it('buildFullSync returns the resolved active page when one exists', () => {
    const a = insertAsset(db, {
      hash: 'h',
      kind: 'map',
      originalName: 'm.png',
      mime: 'image/webp',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });
    const p = createPage(db, {
      name: 'A',
      backgroundAssetId: a.id,
      gridWidthSquares: 20,
      gridHeightSquares: 15,
    });
    setActivePage(db, p.id);
    const dmSocket = { data: { role: 'dm' as const, name: 'DM' as const, playerId: null } };
    const sync = buildFullSync(db, dmSocket, createPresence());
    expect(sync.activePage?.id).toBe(p.id);
    expect(sync.activePage?.background_url).toBe('/assets/h.webp');
    expect(sync.activePage?.is_active).toBe(1);
  });
});
