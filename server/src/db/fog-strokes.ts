import type Database from 'better-sqlite3';

export interface FogStroke {
  id: number;
  pageId: number;
  mode: 'reveal' | 'hide';
  shape: 'brush' | 'rect';
  points: [number, number][];
  radius: number;
  createdAt: number;
}

interface FogStrokeRow {
  id: number;
  page_id: number;
  mode: 'reveal' | 'hide';
  shape: 'brush' | 'rect';
  radius: number;
  points_json: string;
  created_at: number;
}

function rowToFogStroke(row: FogStrokeRow): FogStroke {
  let points: [number, number][] = [];
  try {
    const parsed = JSON.parse(row.points_json);
    if (Array.isArray(parsed)) {
      points = parsed.filter(
        (p) =>
          Array.isArray(p) &&
          p.length === 2 &&
          typeof p[0] === 'number' &&
          typeof p[1] === 'number',
      ) as [number, number][];
    }
  } catch {
    /* corrupt → empty */
  }
  return {
    id: row.id,
    pageId: row.page_id,
    mode: row.mode,
    shape: row.shape,
    points,
    radius: row.radius,
    createdAt: row.created_at,
  };
}

export interface InsertFogStrokeFields {
  pageId: number;
  mode: 'reveal' | 'hide';
  shape: 'brush' | 'rect';
  points: [number, number][];
  radius: number;
}

export function insertFogStroke(
  db: Database.Database,
  fields: InsertFogStrokeFields,
): FogStroke {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO fog_strokes (page_id, mode, shape, radius, points_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.pageId,
      fields.mode,
      fields.shape,
      fields.radius,
      JSON.stringify(fields.points),
      now,
    );
  return findFogStrokeById(db, Number(info.lastInsertRowid))!;
}

export function findFogStrokeById(
  db: Database.Database,
  id: number,
): FogStroke | null {
  const row = db
    .prepare('SELECT * FROM fog_strokes WHERE id = ?')
    .get(id) as FogStrokeRow | undefined;
  return row ? rowToFogStroke(row) : null;
}

export function listFogStrokesByPage(
  db: Database.Database,
  pageId: number,
): FogStroke[] {
  const rows = db
    .prepare('SELECT * FROM fog_strokes WHERE page_id = ? ORDER BY id ASC')
    .all(pageId) as FogStrokeRow[];
  return rows.map(rowToFogStroke);
}

export function deleteFogStrokesForPage(
  db: Database.Database,
  pageId: number,
): number {
  const info = db.prepare('DELETE FROM fog_strokes WHERE page_id = ?').run(pageId);
  return info.changes;
}

// ----- Pure validator -----

const RADIUS_MIN = 1;
const RADIUS_MAX = 4096;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface StrokeInput {
  mode: 'reveal' | 'hide';
  shape: 'brush' | 'rect';
  points: [number, number][];
  radius: number;
}

export type StrokeValidationResult =
  | { ok: true; stroke: StrokeInput }
  | { ok: false; error: string };

export function validateAndNormalizeStroke(
  input: StrokeInput,
  imageW: number,
  imageH: number,
): StrokeValidationResult {
  if (input.mode !== 'reveal' && input.mode !== 'hide') {
    return { ok: false, error: 'invalid mode' };
  }
  if (input.shape !== 'brush' && input.shape !== 'rect') {
    return { ok: false, error: 'invalid shape' };
  }
  if (!Array.isArray(input.points)) {
    return { ok: false, error: 'points must be an array' };
  }
  for (const p of input.points) {
    if (!Array.isArray(p) || p.length !== 2 ||
        !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      return { ok: false, error: 'invalid point' };
    }
  }
  const clipped: [number, number][] = input.points.map(
    ([x, y]) => [clamp(x, 0, imageW), clamp(y, 0, imageH)],
  );

  if (input.shape === 'brush') {
    if (clipped.length < 1) return { ok: false, error: 'brush requires >= 1 point' };
    if (!Number.isFinite(input.radius)) return { ok: false, error: 'invalid radius' };
    const radius = clamp(input.radius, RADIUS_MIN, RADIUS_MAX);
    return {
      ok: true,
      stroke: { mode: input.mode, shape: 'brush', points: clipped, radius },
    };
  }

  // rect
  if (clipped.length !== 2) return { ok: false, error: 'rect requires exactly 2 points' };
  const [a, b] = clipped;
  const x1 = Math.min(a[0], b[0]);
  const y1 = Math.min(a[1], b[1]);
  const x2 = Math.max(a[0], b[0]);
  const y2 = Math.max(a[1], b[1]);
  if (x1 === x2 || y1 === y2) return { ok: false, error: 'zero-area rect' };
  return {
    ok: true,
    stroke: {
      mode: input.mode,
      shape: 'rect',
      points: [[x1, y1], [x2, y2]],
      radius: 0,
    },
  };
}
