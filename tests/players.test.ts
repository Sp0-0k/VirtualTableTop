import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/src/db/migrate.js';
import {
  createPlayer,
  findPlayerById,
  findPlayerByName,
  type Player,
} from '../server/src/db/players.js';

describe('players model', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, 'migrations');
  });

  it('creates a player with createdAt timestamp', () => {
    const p = createPlayer(db, 'Alice', '#aa3344');
    expect(p.id).toBeGreaterThan(0);
    expect(p.name).toBe('Alice');
    expect(p.color).toBe('#aa3344');
    expect(p.createdAt).toBeGreaterThan(0);
  });

  it('finds a player by id', () => {
    const created = createPlayer(db, 'Bob', '#3344aa');
    const found = findPlayerById(db, created.id);
    expect(found).toEqual<Player>(created);
  });

  it('returns null for non-existent id', () => {
    expect(findPlayerById(db, 999)).toBeNull();
  });

  it('finds a player by exact name', () => {
    const created = createPlayer(db, 'Charlie', '#aabb33');
    const found = findPlayerByName(db, 'Charlie');
    expect(found?.id).toBe(created.id);
  });

  it('finds a player by case-insensitive name', () => {
    const created = createPlayer(db, 'Delta', '#33aabb');
    const found = findPlayerByName(db, 'DELTA');
    expect(found?.id).toBe(created.id);
  });

  it('returns null for non-existent name', () => {
    expect(findPlayerByName(db, 'nobody')).toBeNull();
  });

  it('createPlayer throws on duplicate case-insensitive name', () => {
    createPlayer(db, 'Echo', '#a1b2c3');
    expect(() => createPlayer(db, 'ECHO', '#000000')).toThrow();
  });
});
