import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/src/db/migrate.js';

describe('runMigrations', () => {
  it('creates the players table on a fresh db', () => {
    const db = new Database(':memory:');
    runMigrations(db, 'migrations');
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='players'")
      .get();
    expect(row).toEqual({ name: 'players' });
  });

  it('records applied migrations in the _migrations table', () => {
    const db = new Database(':memory:');
    runMigrations(db, 'migrations');
    const rows = db
      .prepare('SELECT filename FROM _migrations ORDER BY filename')
      .all();
    expect(rows).toEqual([
      { filename: '001_initial.sql' },
      { filename: '002_fog_stroke_shape.sql' },
    ]);
  });

  it('is idempotent on a second run', () => {
    const db = new Database(':memory:');
    runMigrations(db, 'migrations');
    runMigrations(db, 'migrations'); // should not throw
    const rows = db.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as { n: number };
    expect(rows.n).toBe(2);
  });

  it('adds shape column to fog_strokes with brush default', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, 'migrations');
    const cols = db
      .prepare("PRAGMA table_info('fog_strokes')")
      .all() as { name: string; dflt_value: string | null }[];
    const shape = cols.find((c) => c.name === 'shape');
    expect(shape).toBeDefined();
    expect(shape!.dflt_value).toBe("'brush'");
  });

  it('CHECK constraint on fog_strokes.shape rejects unknown values', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, 'migrations');
    const m = db
      .prepare(
        `INSERT INTO assets (hash, kind, original_name, mime, width, height, size_bytes, uploaded_at)
         VALUES ('h', 'map', 'm.png', 'image/webp', 100, 100, 1, 0)`,
      )
      .run();
    const p = db
      .prepare(
        `INSERT INTO pages (name, background_asset_id, grid_width_squares, grid_height_squares,
                            sort_order, is_active, settings_json, created_at, updated_at)
         VALUES ('P', ?, 10, 10, 0, 0, '{}', 0, 0)`,
      )
      .run(Number(m.lastInsertRowid));
    expect(() =>
      db
        .prepare(
          `INSERT INTO fog_strokes (page_id, mode, shape, radius, points_json, created_at)
           VALUES (?, 'reveal', 'oops', 10, '[[0,0]]', 0)`,
        )
        .run(Number(p.lastInsertRowid)),
    ).toThrow();
  });

  it('creates all v1 tables from the spec', () => {
    const db = new Database(':memory:');
    runMigrations(db, 'migrations');
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    expect(rows).toEqual([
      { name: '_migrations' },
      { name: 'assets' },
      { name: 'fog_strokes' },
      { name: 'pages' },
      { name: 'players' },
      { name: 'tokens' },
      { name: 'walls' },
    ]);
  });
});
