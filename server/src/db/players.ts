import type Database from 'better-sqlite3';

export interface Player {
  id: number;
  name: string;
  color: string;
  createdAt: number;
  lastSeenAt: number | null;
}

interface PlayerRow {
  id: number;
  name: string;
  color: string;
  created_at: number;
  last_seen_at: number | null;
}

function rowToPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function createPlayer(db: Database.Database, name: string, color: string): Player {
  const now = Date.now();
  const info = db
    .prepare('INSERT INTO players (name, color, created_at) VALUES (?, ?, ?)')
    .run(name, color, now);
  return {
    id: Number(info.lastInsertRowid),
    name,
    color,
    createdAt: now,
    lastSeenAt: null,
  };
}

export function findPlayerById(db: Database.Database, id: number): Player | null {
  const row = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as PlayerRow | undefined;
  return row ? rowToPlayer(row) : null;
}

export function findPlayerByName(db: Database.Database, name: string): Player | null {
  const row = db
    .prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE')
    .get(name) as PlayerRow | undefined;
  return row ? rowToPlayer(row) : null;
}

export function listPlayersForSync(
  db: Database.Database,
): { id: number; name: string; color: string }[] {
  return db
    .prepare('SELECT id, name, color FROM players ORDER BY id ASC')
    .all() as { id: number; name: string; color: string }[];
}
