import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/src/db/migrate.js';
import { findReferences, insertAsset } from '../server/src/db/assets.js';
import { createPage } from '../server/src/db/pages.js';
import { createToken } from '../server/src/db/tokens.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, 'migrations');
  return db;
}

describe('db/assets findReferences', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => db.close());

  it('returns empty arrays when nothing references the asset', () => {
    const a = insertAsset(db, {
      hash: 'h', kind: 'map', originalName: 'm.png', mime: 'image/webp',
      width: 1, height: 1, sizeBytes: 1,
    });
    expect(findReferences(db, a.id)).toEqual({ pages: [], tokens: [] });
  });

  it('lists pages that use this asset as background', () => {
    const a = insertAsset(db, {
      hash: 'h', kind: 'map', originalName: 'm.png', mime: 'image/webp',
      width: 4096, height: 3072, sizeBytes: 1,
    });
    const p1 = createPage(db, {
      name: 'Caves', backgroundAssetId: a.id, gridWidthSquares: 20, gridHeightSquares: 15,
    });
    const p2 = createPage(db, {
      name: 'Tavern', backgroundAssetId: a.id, gridWidthSquares: 20, gridHeightSquares: 15,
    });
    const refs = findReferences(db, a.id);
    expect(refs.pages.map((p) => p.id).sort()).toEqual([p1.id, p2.id].sort());
    expect(refs.pages.find((p) => p.id === p1.id)?.name).toBe('Caves');
    expect(refs.tokens).toEqual([]);
  });

  it('lists tokens that use this asset', () => {
    const map = insertAsset(db, {
      hash: 'm', kind: 'map', originalName: 'm.png', mime: 'image/webp',
      width: 4096, height: 3072, sizeBytes: 1,
    });
    const tok = insertAsset(db, {
      hash: 't', kind: 'token', originalName: 't.png', mime: 'image/webp',
      width: 256, height: 256, sizeBytes: 1,
    });
    const page = createPage(db, {
      name: 'P', backgroundAssetId: map.id, gridWidthSquares: 10, gridHeightSquares: 10,
    });
    const t = createToken(db, {
      pageId: page.id, assetId: tok.id, x: 0, y: 0, name: 'Goblin',
    });
    const refs = findReferences(db, tok.id);
    expect(refs.pages).toEqual([]);
    expect(refs.tokens).toEqual([{ id: t.id, name: 'Goblin', pageId: page.id }]);
  });
});
