import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/src/db/migrate.js';
import { insertAsset } from '../server/src/db/assets.js';
import { createPage } from '../server/src/db/pages.js';
import {
  insertFogStroke,
  listFogStrokesByPage,
  deleteFogStrokesForPage,
  validateAndNormalizeStroke,
} from '../server/src/db/fog-strokes.js';

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, 'migrations');
  const a = insertAsset(db, {
    hash: 'm', kind: 'map', originalName: 'm.png', mime: 'image/webp',
    width: 1000, height: 800, sizeBytes: 1,
  });
  const p = createPage(db, {
    name: 'P', backgroundAssetId: a.id, gridWidthSquares: 10, gridHeightSquares: 8,
  });
  return { db, pageId: p.id, imgW: 1000, imgH: 800 };
}

describe('insertFogStroke / listFogStrokesByPage', () => {
  it('round-trips a brush stroke', () => {
    const f = fixture();
    const s = insertFogStroke(f.db, {
      pageId: f.pageId, mode: 'reveal', shape: 'brush',
      points: [[10, 20], [30, 40]], radius: 25,
    });
    expect(s.id).toBeGreaterThan(0);
    expect(s.points).toEqual([[10, 20], [30, 40]]);
    const list = listFogStrokesByPage(f.db, f.pageId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: s.id, mode: 'reveal', shape: 'brush', radius: 25,
    });
  });

  it('round-trips a rect stroke', () => {
    const f = fixture();
    insertFogStroke(f.db, {
      pageId: f.pageId, mode: 'hide', shape: 'rect',
      points: [[0, 0], [100, 100]], radius: 0,
    });
    const list = listFogStrokesByPage(f.db, f.pageId);
    expect(list[0].shape).toBe('rect');
    expect(list[0].radius).toBe(0);
  });

  it('returns strokes in insertion (id) order', () => {
    const f = fixture();
    const a = insertFogStroke(f.db, {
      pageId: f.pageId, mode: 'reveal', shape: 'brush', points: [[1, 1]], radius: 10,
    });
    const b = insertFogStroke(f.db, {
      pageId: f.pageId, mode: 'hide', shape: 'brush', points: [[2, 2]], radius: 10,
    });
    const list = listFogStrokesByPage(f.db, f.pageId);
    expect(list.map((s) => s.id)).toEqual([a.id, b.id]);
  });

  it('deleteFogStrokesForPage removes all rows for that page', () => {
    const f = fixture();
    insertFogStroke(f.db, {
      pageId: f.pageId, mode: 'reveal', shape: 'brush', points: [[1, 1]], radius: 10,
    });
    insertFogStroke(f.db, {
      pageId: f.pageId, mode: 'reveal', shape: 'brush', points: [[2, 2]], radius: 10,
    });
    const removed = deleteFogStrokesForPage(f.db, f.pageId);
    expect(removed).toBe(2);
    expect(listFogStrokesByPage(f.db, f.pageId)).toEqual([]);
  });
});

describe('validateAndNormalizeStroke', () => {
  const W = 1000, H = 800;

  it('accepts a valid brush stroke', () => {
    const r = validateAndNormalizeStroke(
      { mode: 'reveal', shape: 'brush', points: [[10, 20], [30, 40]], radius: 50 },
      W, H,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stroke.points).toEqual([[10, 20], [30, 40]]);
      expect(r.stroke.radius).toBe(50);
    }
  });

  it('clips brush points to image bounds', () => {
    const r = validateAndNormalizeStroke(
      { mode: 'reveal', shape: 'brush', points: [[-5, 1500], [2000, -10]], radius: 10 },
      W, H,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stroke.points).toEqual([[0, 800], [1000, 0]]);
  });

  it('clamps brush radius to [1, 4096]', () => {
    const small = validateAndNormalizeStroke(
      { mode: 'reveal', shape: 'brush', points: [[1, 1]], radius: 0 },
      W, H,
    );
    expect(small.ok).toBe(true);
    if (small.ok) expect(small.stroke.radius).toBe(1);
    const huge = validateAndNormalizeStroke(
      { mode: 'reveal', shape: 'brush', points: [[1, 1]], radius: 99999 },
      W, H,
    );
    expect(huge.ok).toBe(true);
    if (huge.ok) expect(huge.stroke.radius).toBe(4096);
  });

  it('rejects brush with empty points', () => {
    const r = validateAndNormalizeStroke(
      { mode: 'reveal', shape: 'brush', points: [], radius: 10 },
      W, H,
    );
    expect(r.ok).toBe(false);
  });

  it('rejects unknown mode/shape', () => {
    expect(
      validateAndNormalizeStroke(
        { mode: 'bogus' as 'reveal', shape: 'brush', points: [[1, 1]], radius: 10 },
        W, H,
      ).ok,
    ).toBe(false);
    expect(
      validateAndNormalizeStroke(
        { mode: 'reveal', shape: 'circle' as 'brush', points: [[1, 1]], radius: 10 },
        W, H,
      ).ok,
    ).toBe(false);
  });

  it('normalizes rect corners and forces radius=0', () => {
    const r = validateAndNormalizeStroke(
      { mode: 'hide', shape: 'rect', points: [[100, 200], [10, 20]], radius: 99 },
      W, H,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stroke.points).toEqual([[10, 20], [100, 200]]);
      expect(r.stroke.radius).toBe(0);
    }
  });

  it('rejects rect with !=2 points', () => {
    expect(
      validateAndNormalizeStroke(
        { mode: 'reveal', shape: 'rect', points: [[1, 1]], radius: 0 },
        W, H,
      ).ok,
    ).toBe(false);
    expect(
      validateAndNormalizeStroke(
        { mode: 'reveal', shape: 'rect', points: [[1, 1], [2, 2], [3, 3]], radius: 0 },
        W, H,
      ).ok,
    ).toBe(false);
  });

  it('rejects zero-area rect', () => {
    const r = validateAndNormalizeStroke(
      { mode: 'reveal', shape: 'rect', points: [[100, 100], [100, 100]], radius: 0 },
      W, H,
    );
    expect(r.ok).toBe(false);
  });

  it('clips rect points to image bounds', () => {
    const r = validateAndNormalizeStroke(
      { mode: 'reveal', shape: 'rect', points: [[-50, -50], [2000, 2000]], radius: 0 },
      W, H,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stroke.points).toEqual([[0, 0], [1000, 800]]);
  });
});
