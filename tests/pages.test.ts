import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/src/db/migrate.js';
import { insertAsset } from '../server/src/db/assets.js';
import {
  PageError,
  createPage,
  deletePage,
  findActivePage,
  findPageById,
  listPages,
  setActivePage,
  updatePage,
} from '../server/src/db/pages.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, 'migrations');
  return db;
}

function seedAsset(db: Database.Database, hash = 'h'): number {
  return insertAsset(db, {
    hash,
    kind: 'map',
    originalName: 'm.png',
    mime: 'image/webp',
    width: 1,
    height: 1,
    sizeBytes: 1,
  }).id;
}

describe('pages db module', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('createPage assigns sort_order = (max + 1) and is_active = 0', () => {
    const a = seedAsset(db);
    const p1 = createPage(db, {
      name: 'A',
      backgroundAssetId: a,
      gridWidthSquares: 20,
      gridHeightSquares: 15,
    });
    const p2 = createPage(db, {
      name: 'B',
      backgroundAssetId: a,
      gridWidthSquares: 20,
      gridHeightSquares: 15,
    });
    expect(p1.sortOrder).toBe(0);
    expect(p2.sortOrder).toBe(1);
    expect(p1.isActive).toBe(0);
    expect(p2.isActive).toBe(0);
  });

  it('listPages returns sorted by sort_order ascending', () => {
    const a = seedAsset(db);
    const p1 = createPage(db, { name: 'A', backgroundAssetId: a, gridWidthSquares: 1, gridHeightSquares: 1 });
    const p2 = createPage(db, { name: 'B', backgroundAssetId: a, gridWidthSquares: 1, gridHeightSquares: 1 });
    expect(listPages(db).map((p) => p.id)).toEqual([p1.id, p2.id]);
  });

  it('findPageById returns null on miss', () => {
    expect(findPageById(db, 999)).toBeNull();
  });

  it('setActivePage is exclusive (only one is_active=1 ever)', () => {
    const a = seedAsset(db);
    const p1 = createPage(db, { name: 'A', backgroundAssetId: a, gridWidthSquares: 1, gridHeightSquares: 1 });
    const p2 = createPage(db, { name: 'B', backgroundAssetId: a, gridWidthSquares: 1, gridHeightSquares: 1 });
    setActivePage(db, p1.id);
    expect(findActivePage(db)?.id).toBe(p1.id);
    setActivePage(db, p2.id);
    expect(findActivePage(db)?.id).toBe(p2.id);
    const all = listPages(db);
    expect(all.filter((p) => p.isActive === 1)).toHaveLength(1);
  });

  it('setActivePage throws NOT_FOUND for unknown id', () => {
    expect(() => setActivePage(db, 999)).toThrowError(PageError);
  });

  it('updatePage updates only provided fields', () => {
    const a = seedAsset(db);
    const p = createPage(db, {
      name: 'A',
      backgroundAssetId: a,
      gridWidthSquares: 20,
      gridHeightSquares: 15,
    });
    const u = updatePage(db, p.id, { name: 'A renamed' });
    expect(u.name).toBe('A renamed');
    expect(u.gridWidthSquares).toBe(20);
  });

  it('updatePage throws NOT_FOUND for unknown id', () => {
    expect(() => updatePage(db, 999, { name: 'x' })).toThrowError(PageError);
  });

  it('deletePage refuses an active page (ACTIVE_DELETE)', () => {
    const a = seedAsset(db);
    const p = createPage(db, { name: 'A', backgroundAssetId: a, gridWidthSquares: 1, gridHeightSquares: 1 });
    setActivePage(db, p.id);
    expect(() => deletePage(db, p.id)).toThrowError(PageError);
  });

  it('deletePage removes a non-active page', () => {
    const a = seedAsset(db);
    const p = createPage(db, { name: 'A', backgroundAssetId: a, gridWidthSquares: 1, gridHeightSquares: 1 });
    deletePage(db, p.id);
    expect(findPageById(db, p.id)).toBeNull();
  });

  it('deletePage throws NOT_FOUND for unknown id', () => {
    expect(() => deletePage(db, 999)).toThrowError(PageError);
  });
});
