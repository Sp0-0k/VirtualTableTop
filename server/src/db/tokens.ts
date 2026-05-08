import type Database from 'better-sqlite3';
import { findAssetById } from './assets.js';

export interface Token {
  id: number;
  pageId: number;
  assetId: number;
  name: string | null;
  x: number;
  y: number;
  sizeSquares: number;
  ownerPlayerId: number | null;
  hidden: 0 | 1;
  currentHp: number | null;
  maxHp: number | null;
  conditions: string[];
  hpVisibleToPlayers: 0 | 1;
  zIndex: number;
}

interface TokenRow {
  id: number;
  page_id: number;
  asset_id: number;
  name: string | null;
  x: number;
  y: number;
  size_squares: number;
  owner_player_id: number | null;
  hidden: 0 | 1;
  current_hp: number | null;
  max_hp: number | null;
  conditions_json: string;
  hp_visible_to_players: 0 | 1;
  vision_distance: number | null;
  light_radius: number | null;
  z_index: number;
  created_at: number;
  updated_at: number;
}

function rowToToken(row: TokenRow): Token {
  let conditions: string[] = [];
  try {
    const parsed = JSON.parse(row.conditions_json);
    if (Array.isArray(parsed)) conditions = parsed.filter((s) => typeof s === 'string');
  } catch {
    /* corrupt JSON → empty list */
  }
  return {
    id: row.id,
    pageId: row.page_id,
    assetId: row.asset_id,
    name: row.name,
    x: row.x,
    y: row.y,
    sizeSquares: row.size_squares,
    ownerPlayerId: row.owner_player_id,
    hidden: row.hidden,
    currentHp: row.current_hp,
    maxHp: row.max_hp,
    conditions,
    hpVisibleToPlayers: row.hp_visible_to_players,
    zIndex: row.z_index,
  };
}

export type TokenErrorCode = 'NOT_FOUND' | 'BAD_ASSET';

export class TokenError extends Error {
  constructor(public readonly code: TokenErrorCode, message: string) {
    super(message);
    this.name = 'TokenError';
  }
}

export interface CreateTokenFields {
  pageId: number;
  assetId: number;
  x: number;
  y: number;
  sizeSquares?: number;
  name?: string | null;
  ownerPlayerId?: number | null;
}

export function createToken(db: Database.Database, fields: CreateTokenFields): Token {
  const asset = findAssetById(db, fields.assetId);
  if (!asset || asset.kind !== 'token') {
    throw new TokenError('BAD_ASSET', 'asset must be of kind=token');
  }
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO tokens (
         page_id, asset_id, name, x, y, size_squares, owner_player_id, hidden,
         current_hp, max_hp, conditions_json, hp_visible_to_players,
         z_index, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, '[]', 1, 0, ?, ?)`,
    )
    .run(
      fields.pageId,
      fields.assetId,
      fields.name ?? null,
      fields.x,
      fields.y,
      fields.sizeSquares ?? 1,
      fields.ownerPlayerId ?? null,
      now,
      now,
    );
  return findTokenById(db, Number(info.lastInsertRowid))!;
}

export function findTokenById(db: Database.Database, id: number): Token | null {
  const row = db.prepare('SELECT * FROM tokens WHERE id = ?').get(id) as TokenRow | undefined;
  return row ? rowToToken(row) : null;
}

export function listTokensByPage(db: Database.Database, pageId: number): Token[] {
  const rows = db
    .prepare('SELECT * FROM tokens WHERE page_id = ? ORDER BY z_index ASC, id ASC')
    .all(pageId) as TokenRow[];
  return rows.map(rowToToken);
}

export interface UpdateTokenFields {
  name?: string | null;
  ownerPlayerId?: number | null;
  sizeSquares?: number;
  hidden?: 0 | 1;
  currentHp?: number | null;
  maxHp?: number | null;
  conditions?: string[];
  hpVisibleToPlayers?: 0 | 1;
  x?: number;
  y?: number;
  zIndex?: number;
}

export function updateToken(
  db: Database.Database,
  id: number,
  fields: UpdateTokenFields,
): Token {
  const existing = findTokenById(db, id);
  if (!existing) throw new TokenError('NOT_FOUND', `token ${id} not found`);
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const push = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    values.push(v);
  };
  if (fields.name !== undefined) push('name', fields.name);
  if (fields.ownerPlayerId !== undefined) push('owner_player_id', fields.ownerPlayerId);
  if (fields.sizeSquares !== undefined) push('size_squares', fields.sizeSquares);
  if (fields.hidden !== undefined) push('hidden', fields.hidden);
  if (fields.currentHp !== undefined) push('current_hp', fields.currentHp);
  if (fields.maxHp !== undefined) push('max_hp', fields.maxHp);
  if (fields.conditions !== undefined) push('conditions_json', JSON.stringify(fields.conditions));
  if (fields.hpVisibleToPlayers !== undefined)
    push('hp_visible_to_players', fields.hpVisibleToPlayers);
  if (fields.x !== undefined) push('x', fields.x);
  if (fields.y !== undefined) push('y', fields.y);
  if (fields.zIndex !== undefined) push('z_index', fields.zIndex);
  if (sets.length === 0) return existing;

  sets.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  db.prepare(`UPDATE tokens SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return findTokenById(db, id)!;
}

export function updateTokenXY(
  db: Database.Database,
  id: number,
  x: number,
  y: number,
): Token {
  const info = db
    .prepare('UPDATE tokens SET x = ?, y = ?, updated_at = ? WHERE id = ?')
    .run(x, y, Date.now(), id);
  if (info.changes === 0) throw new TokenError('NOT_FOUND', `token ${id} not found`);
  return findTokenById(db, id)!;
}

export function deleteToken(db: Database.Database, id: number): void {
  const info = db.prepare('DELETE FROM tokens WHERE id = ?').run(id);
  if (info.changes === 0) throw new TokenError('NOT_FOUND', `token ${id} not found`);
}
