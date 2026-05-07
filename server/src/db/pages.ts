import type Database from 'better-sqlite3';

export interface Page {
  id: number;
  name: string;
  backgroundAssetId: number | null;
  gridWidthSquares: number;
  gridHeightSquares: number;
  sortOrder: number;
  isActive: 0 | 1;
}

interface PageRow {
  id: number;
  name: string;
  background_asset_id: number | null;
  grid_width_squares: number;
  grid_height_squares: number;
  sort_order: number;
  is_active: 0 | 1;
}

function rowToPage(row: PageRow): Page {
  return {
    id: row.id,
    name: row.name,
    backgroundAssetId: row.background_asset_id,
    gridWidthSquares: row.grid_width_squares,
    gridHeightSquares: row.grid_height_squares,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

export type PageErrorCode = 'NOT_FOUND' | 'ACTIVE_DELETE';

export class PageError extends Error {
  constructor(
    public readonly code: PageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PageError';
  }
}

export interface CreatePageFields {
  name: string;
  backgroundAssetId: number | null;
  gridWidthSquares: number;
  gridHeightSquares: number;
}

export function listPages(db: Database.Database): Page[] {
  const rows = db
    .prepare('SELECT * FROM pages ORDER BY sort_order ASC, id ASC')
    .all() as PageRow[];
  return rows.map(rowToPage);
}

export function findPageById(db: Database.Database, id: number): Page | null {
  const row = db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as PageRow | undefined;
  return row ? rowToPage(row) : null;
}

export function findActivePage(db: Database.Database): Page | null {
  const row = db
    .prepare('SELECT * FROM pages WHERE is_active = 1 LIMIT 1')
    .get() as PageRow | undefined;
  return row ? rowToPage(row) : null;
}

export function createPage(db: Database.Database, fields: CreatePageFields): Page {
  const now = Date.now();
  const nextSort =
    (db.prepare('SELECT COALESCE(MAX(sort_order) + 1, 0) AS n FROM pages').get() as { n: number })
      .n;
  const info = db
    .prepare(
      `INSERT INTO pages (name, background_asset_id, grid_width_squares, grid_height_squares,
                          sort_order, is_active, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, '{}', ?, ?)`,
    )
    .run(
      fields.name,
      fields.backgroundAssetId,
      fields.gridWidthSquares,
      fields.gridHeightSquares,
      nextSort,
      now,
      now,
    );
  const id = Number(info.lastInsertRowid);
  return findPageById(db, id)!;
}

export interface UpdatePageFields {
  name?: string;
  backgroundAssetId?: number | null;
  gridWidthSquares?: number;
  gridHeightSquares?: number;
  sortOrder?: number;
}

export function updatePage(
  db: Database.Database,
  id: number,
  fields: UpdatePageFields,
): Page {
  const existing = findPageById(db, id);
  if (!existing) throw new PageError('NOT_FOUND', `page ${id} not found`);

  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (fields.name !== undefined) {
    sets.push('name = ?');
    values.push(fields.name);
  }
  if (fields.backgroundAssetId !== undefined) {
    sets.push('background_asset_id = ?');
    values.push(fields.backgroundAssetId);
  }
  if (fields.gridWidthSquares !== undefined) {
    sets.push('grid_width_squares = ?');
    values.push(fields.gridWidthSquares);
  }
  if (fields.gridHeightSquares !== undefined) {
    sets.push('grid_height_squares = ?');
    values.push(fields.gridHeightSquares);
  }
  if (fields.sortOrder !== undefined) {
    sets.push('sort_order = ?');
    values.push(fields.sortOrder);
  }
  if (sets.length === 0) return existing;

  sets.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  db.prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return findPageById(db, id)!;
}

export function deletePage(db: Database.Database, id: number): void {
  const existing = findPageById(db, id);
  if (!existing) throw new PageError('NOT_FOUND', `page ${id} not found`);
  if (existing.isActive === 1) {
    throw new PageError('ACTIVE_DELETE', 'cannot delete the active page; set another active first');
  }
  db.prepare('DELETE FROM pages WHERE id = ?').run(id);
}

export function setActivePage(db: Database.Database, id: number): Page {
  const tx = db.transaction((targetId: number) => {
    const existing = findPageById(db, targetId);
    if (!existing) throw new PageError('NOT_FOUND', `page ${targetId} not found`);
    db.prepare('UPDATE pages SET is_active = 0, updated_at = ? WHERE is_active = 1').run(Date.now());
    db.prepare('UPDATE pages SET is_active = 1, updated_at = ? WHERE id = ?').run(
      Date.now(),
      targetId,
    );
  });
  tx(id);
  return findPageById(db, id)!;
}
