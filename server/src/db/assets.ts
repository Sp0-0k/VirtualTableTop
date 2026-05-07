import type Database from 'better-sqlite3';

export type AssetKind = 'map' | 'token';

export interface Asset {
  id: number;
  hash: string;
  kind: AssetKind;
  originalName: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
  uploadedAt: number;
}

interface AssetRow {
  id: number;
  hash: string;
  kind: AssetKind;
  original_name: string;
  mime: string;
  width: number;
  height: number;
  size_bytes: number;
  uploaded_at: number;
}

function rowToAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    hash: row.hash,
    kind: row.kind,
    originalName: row.original_name,
    mime: row.mime,
    width: row.width,
    height: row.height,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
  };
}

export interface InsertAssetFields {
  hash: string;
  kind: AssetKind;
  originalName: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export function insertAsset(db: Database.Database, fields: InsertAssetFields): Asset {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO assets (hash, kind, original_name, mime, width, height, size_bytes, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.hash,
      fields.kind,
      fields.originalName,
      fields.mime,
      fields.width,
      fields.height,
      fields.sizeBytes,
      now,
    );
  return {
    id: Number(info.lastInsertRowid),
    hash: fields.hash,
    kind: fields.kind,
    originalName: fields.originalName,
    mime: fields.mime,
    width: fields.width,
    height: fields.height,
    sizeBytes: fields.sizeBytes,
    uploadedAt: now,
  };
}

export function findAssetByHash(db: Database.Database, hash: string): Asset | null {
  const row = db.prepare('SELECT * FROM assets WHERE hash = ?').get(hash) as AssetRow | undefined;
  return row ? rowToAsset(row) : null;
}

export function findAssetById(db: Database.Database, id: number): Asset | null {
  const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined;
  return row ? rowToAsset(row) : null;
}

export function listAssets(db: Database.Database, kind: AssetKind): Asset[] {
  const rows = db
    .prepare('SELECT * FROM assets WHERE kind = ? ORDER BY uploaded_at DESC, id DESC')
    .all(kind) as AssetRow[];
  return rows.map(rowToAsset);
}
