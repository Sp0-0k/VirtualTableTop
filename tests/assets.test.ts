import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/src/db/migrate.js';
import {
  findAssetByHash,
  findAssetById,
  insertAsset,
  listAssets,
} from '../server/src/db/assets.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, 'migrations');
  return db;
}

describe('assets db module', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('insertAsset returns a camelCase Asset', () => {
    const a = insertAsset(db, {
      hash: 'h1',
      kind: 'map',
      originalName: 'cave.png',
      mime: 'image/webp',
      width: 800,
      height: 600,
      sizeBytes: 12345,
    });
    expect(a.id).toBeGreaterThan(0);
    expect(a.hash).toBe('h1');
    expect(a.kind).toBe('map');
    expect(a.originalName).toBe('cave.png');
    expect(a.width).toBe(800);
    expect(a.height).toBe(600);
    expect(a.sizeBytes).toBe(12345);
    expect(a.uploadedAt).toBeGreaterThan(0);
  });

  it('findAssetByHash returns null on miss, the row on hit', () => {
    expect(findAssetByHash(db, 'nope')).toBeNull();
    insertAsset(db, {
      hash: 'h2',
      kind: 'map',
      originalName: 'x.png',
      mime: 'image/webp',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });
    const found = findAssetByHash(db, 'h2');
    expect(found?.hash).toBe('h2');
  });

  it('findAssetById round-trips', () => {
    const a = insertAsset(db, {
      hash: 'h3',
      kind: 'map',
      originalName: 'x.png',
      mime: 'image/webp',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });
    expect(findAssetById(db, a.id)?.id).toBe(a.id);
    expect(findAssetById(db, 999)).toBeNull();
  });

  it('listAssets filters by kind, newest first', async () => {
    const m1 = insertAsset(db, {
      hash: 'm1',
      kind: 'map',
      originalName: 'm1.png',
      mime: 'image/webp',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    const m2 = insertAsset(db, {
      hash: 'm2',
      kind: 'map',
      originalName: 'm2.png',
      mime: 'image/webp',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });
    insertAsset(db, {
      hash: 't1',
      kind: 'token',
      originalName: 't1.png',
      mime: 'image/webp',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });

    const maps = listAssets(db, 'map');
    expect(maps.map((a) => a.id)).toEqual([m2.id, m1.id]);
    const tokens = listAssets(db, 'token');
    expect(tokens.length).toBe(1);
  });
});
