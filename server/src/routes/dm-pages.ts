import { Router } from 'express';
import type Database from 'better-sqlite3';
import { requireDm } from '../auth/dm-guard.js';
import { broadcastActivePageChanged, resolvePageWithUrl } from '../broadcast.js';
import { findAssetById } from '../db/assets.js';
import {
  PageError,
  createPage,
  deletePage,
  listPages,
  setActivePage,
  updatePage,
} from '../db/pages.js';
import type { AppSocketIOServer } from '../socket.js';

export interface DmPagesDeps {
  db: Database.Database;
  io: AppSocketIOServer;
}

interface CreateBody {
  name?: unknown;
  background_asset_id?: unknown;
  grid_width_squares?: unknown;
  grid_height_squares?: unknown;
}

function validateCreate(body: CreateBody, db: Database.Database): string | null {
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return 'name required';
  }
  if (!Number.isInteger(body.grid_width_squares) || (body.grid_width_squares as number) < 1) {
    return 'grid_width_squares must be a positive integer';
  }
  if (!Number.isInteger(body.grid_height_squares) || (body.grid_height_squares as number) < 1) {
    return 'grid_height_squares must be a positive integer';
  }
  if (body.background_asset_id !== null && body.background_asset_id !== undefined) {
    if (!Number.isInteger(body.background_asset_id)) {
      return 'background_asset_id must be an integer or null';
    }
    const asset = findAssetById(db, body.background_asset_id as number);
    if (!asset || asset.kind !== 'map') {
      return 'unknown background_asset_id';
    }
  }
  return null;
}

interface PatchBody {
  name?: unknown;
  background_asset_id?: unknown;
  grid_width_squares?: unknown;
  grid_height_squares?: unknown;
  sort_order?: unknown;
}

function buildPatchFields(
  body: PatchBody,
  db: Database.Database,
): { ok: true; fields: Parameters<typeof updatePage>[2] } | { ok: false; error: string } {
  const fields: Parameters<typeof updatePage>[2] = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return { ok: false, error: 'name must be a non-empty string' };
    }
    fields.name = body.name;
  }
  if (body.background_asset_id !== undefined) {
    if (body.background_asset_id !== null) {
      if (!Number.isInteger(body.background_asset_id)) {
        return { ok: false, error: 'background_asset_id must be integer or null' };
      }
      const a = findAssetById(db, body.background_asset_id as number);
      if (!a || a.kind !== 'map') return { ok: false, error: 'unknown background_asset_id' };
    }
    fields.backgroundAssetId = body.background_asset_id as number | null;
  }
  if (body.grid_width_squares !== undefined) {
    if (!Number.isInteger(body.grid_width_squares) || (body.grid_width_squares as number) < 1) {
      return { ok: false, error: 'grid_width_squares must be a positive integer' };
    }
    fields.gridWidthSquares = body.grid_width_squares as number;
  }
  if (body.grid_height_squares !== undefined) {
    if (!Number.isInteger(body.grid_height_squares) || (body.grid_height_squares as number) < 1) {
      return { ok: false, error: 'grid_height_squares must be a positive integer' };
    }
    fields.gridHeightSquares = body.grid_height_squares as number;
  }
  if (body.sort_order !== undefined) {
    if (!Number.isInteger(body.sort_order)) {
      return { ok: false, error: 'sort_order must be an integer' };
    }
    fields.sortOrder = body.sort_order as number;
  }
  return { ok: true, fields };
}

export function dmPagesRouter(deps: DmPagesDeps): Router {
  const router = Router();
  router.use(requireDm);

  router.get('/', (_req, res) => {
    const list = listPages(deps.db).map((p) => resolvePageWithUrl(deps.db, p));
    res.json({ pages: list });
  });

  router.post('/', (req, res) => {
    const body: CreateBody = req.body ?? {};
    const err = validateCreate(body, deps.db);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
    const page = createPage(deps.db, {
      name: (body.name as string).trim(),
      backgroundAssetId: (body.background_asset_id as number | null | undefined) ?? null,
      gridWidthSquares: body.grid_width_squares as number,
      gridHeightSquares: body.grid_height_squares as number,
    });
    const resolved = resolvePageWithUrl(deps.db, page);
    deps.io.to('dm').emit('page:created', { page: resolved });
    res.status(201).json({ page: resolved });
  });

  router.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const built = buildPatchFields(req.body ?? {}, deps.db);
    if (!built.ok) {
      res.status(400).json({ error: built.error });
      return;
    }
    try {
      const updated = updatePage(deps.db, id, built.fields);
      const resolved = resolvePageWithUrl(deps.db, updated);
      deps.io.to('dm').emit('page:updated', { page: resolved });
      res.json({ page: resolved });
    } catch (err) {
      if (err instanceof PageError && err.code === 'NOT_FOUND') {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    try {
      deletePage(deps.db, id);
      deps.io.to('dm').emit('page:deleted', { id });
      res.status(204).end();
    } catch (err) {
      if (err instanceof PageError) {
        if (err.code === 'NOT_FOUND') {
          res.status(404).json({ error: err.message });
          return;
        }
        if (err.code === 'ACTIVE_DELETE') {
          res.status(409).json({ error: err.message });
          return;
        }
      }
      throw err;
    }
  });

  router.put('/:id/set-active', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    try {
      const page = setActivePage(deps.db, id);
      const resolved = resolvePageWithUrl(deps.db, page);
      broadcastActivePageChanged(deps.io, resolved);
      res.json({ page: resolved });
    } catch (err) {
      if (err instanceof PageError && err.code === 'NOT_FOUND') {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}
