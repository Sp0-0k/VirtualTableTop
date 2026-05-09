import { Router } from 'express';
import type Database from 'better-sqlite3';
import { requireDm } from '../auth/dm-guard.js';
import { findAssetById } from '../db/assets.js';
import { findActivePage, findPageById } from '../db/pages.js';
import {
  deleteFogStrokesForPage,
  insertFogStroke,
  listFogStrokesByPage,
} from '../db/fog-strokes.js';
import { broadcastFogEvent, fogStrokeToPayload } from '../broadcast.js';
import type { AppSocketIOServer } from '../socket.js';

export interface DmFogDeps {
  db: Database.Database;
  io: AppSocketIOServer;
}

export function dmFogRouter(deps: DmFogDeps): Router {
  const r = Router({ mergeParams: true });
  r.use(requireDm);

  r.delete('/:id/fog', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const page = findPageById(deps.db, id);
    if (!page) {
      res.status(404).json({ error: 'page not found' });
      return;
    }
    deleteFogStrokesForPage(deps.db, id);
    const active = findActivePage(deps.db);
    broadcastFogEvent(
      deps.io,
      'fog:cleared',
      { page_id: id },
      active?.id ?? null,
    );
    res.status(204).end();
  });

  r.post('/:id/fog/reveal-all', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const page = findPageById(deps.db, id);
    if (!page) {
      res.status(404).json({ error: 'page not found' });
      return;
    }
    if (page.backgroundAssetId === null) {
      res.status(409).json({ error: 'page has no background asset' });
      return;
    }
    const asset = findAssetById(deps.db, page.backgroundAssetId);
    if (!asset) {
      res.status(409).json({ error: 'background asset missing' });
      return;
    }

    const tx = deps.db.transaction(() => {
      deleteFogStrokesForPage(deps.db, id);
      return insertFogStroke(deps.db, {
        pageId: id,
        mode: 'reveal',
        shape: 'rect',
        points: [[0, 0], [asset.width, asset.height]],
        radius: 0,
      });
    });
    const newStroke = tx();

    const active = findActivePage(deps.db);
    const activeId = active?.id ?? null;
    broadcastFogEvent(deps.io, 'fog:cleared', { page_id: id }, activeId);
    broadcastFogEvent(
      deps.io,
      'fog:stroke_added',
      { page_id: id, stroke: fogStrokeToPayload(newStroke) },
      activeId,
    );
    res.status(204).end();
  });

  // GET strokes for a page — minimal debugging/reload hook.
  r.get('/:id/fog', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    if (!findPageById(deps.db, id)) {
      res.status(404).json({ error: 'page not found' });
      return;
    }
    const strokes = listFogStrokesByPage(deps.db, id).map(fogStrokeToPayload);
    res.json({ strokes });
  });

  return r;
}
