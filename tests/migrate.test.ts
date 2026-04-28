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
    expect(rows).toEqual([{ filename: '001_initial.sql' }]);
  });

  it('is idempotent on a second run', () => {
    const db = new Database(':memory:');
    runMigrations(db, 'migrations');
    runMigrations(db, 'migrations'); // should not throw
    const rows = db.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as { n: number };
    expect(rows.n).toBe(1);
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
