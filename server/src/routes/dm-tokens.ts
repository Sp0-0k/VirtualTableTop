import { Router } from 'express';
import type Database from 'better-sqlite3';
import { requireDm } from '../auth/dm-guard.js';
import { findAssetById } from '../db/assets.js';
import { findPageById } from '../db/pages.js';
import {
  TokenError, createToken, deleteToken, findTokenById, listTokensByPage, updateToken,
} from '../db/tokens.js';
import { broadcastTokenEvent, tokenForSocket } from '../broadcast.js';
import type { AppSocketIOServer } from '../socket.js';

export interface DmTokensDeps {
  db: Database.Database;
  io: AppSocketIOServer;
}

function payloadForDm(db: Database.Database, tokenId: number) {
  const t = findTokenById(db, tokenId)!;
  const asset = findAssetById(db, t.assetId)!;
  return tokenForSocket(
    t,
    { data: { role: 'dm', name: 'DM', playerId: null } },
    `/assets/${asset.hash}.webp`,
    `/assets/${asset.hash}.thumb.webp`,
  )!;
}

export function dmTokensRouter(deps: DmTokensDeps): Router {
  const r = Router();
  r.use(requireDm);

  r.get('/', (req, res) => {
    const pageIdRaw = req.query.page_id;
    const pageId = Number(pageIdRaw);
    if (!Number.isInteger(pageId)) return res.status(400).json({ error: 'page_id required' });
    if (!findPageById(deps.db, pageId)) return res.status(400).json({ error: 'unknown page_id' });
    const tokens = listTokensByPage(deps.db, pageId).map((t) => payloadForDm(deps.db, t.id));
    return res.json({ tokens });
  });

  r.post('/', (req, res) => {
    const body = req.body as Record<string, unknown>;
    const pageId = Number(body.page_id);
    const assetId = Number(body.asset_id);
    const x = Number(body.x);
    const y = Number(body.y);
    if (![pageId, assetId].every(Number.isInteger))
      return res.status(400).json({ error: 'page_id and asset_id required' });
    if (!Number.isFinite(x) || !Number.isFinite(y))
      return res.status(400).json({ error: 'x and y required' });
    if (!findPageById(deps.db, pageId))
      return res.status(400).json({ error: 'unknown page_id' });
    const asset = findAssetById(deps.db, assetId);
    if (!asset || asset.kind !== 'token')
      return res.status(400).json({ error: 'asset must exist and be kind=token' });
    const sizeSquares =
      body.size_squares === undefined ? 1 : Number(body.size_squares);
    if (!Number.isInteger(sizeSquares) || sizeSquares < 1 || sizeSquares > 4)
      return res.status(400).json({ error: 'size_squares must be 1..4' });
    const name = typeof body.name === 'string' ? body.name : null;
    try {
      const t = createToken(deps.db, { pageId, assetId, x, y, sizeSquares, name });
      broadcastTokenEvent(deps.io, deps.db, 'token:created', t);
      return res.status(201).json({ token: payloadForDm(deps.db, t.id) });
    } catch (e) {
      if (e instanceof TokenError) return res.status(400).json({ error: e.message });
      throw e;
    }
  });

  r.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const body = req.body as Record<string, unknown>;
    const fields: Parameters<typeof updateToken>[2] = {};
    const numField = (k: string) => {
      if (body[k] === undefined) return undefined;
      const n = Number(body[k]);
      return Number.isFinite(n) ? n : null;
    };
    if (body.name !== undefined) {
      if (body.name !== null && typeof body.name !== 'string')
        return res.status(400).json({ error: 'name must be string|null' });
      fields.name = body.name as string | null;
    }
    if (body.owner_player_id !== undefined) {
      if (body.owner_player_id !== null && !Number.isInteger(body.owner_player_id))
        return res.status(400).json({ error: 'owner_player_id must be int|null' });
      fields.ownerPlayerId = body.owner_player_id as number | null;
    }
    if (body.size_squares !== undefined) {
      const n = Number(body.size_squares);
      if (!Number.isInteger(n) || n < 1 || n > 4)
        return res.status(400).json({ error: 'size_squares must be 1..4' });
      fields.sizeSquares = n;
    }
    if (body.hidden !== undefined) {
      const v = body.hidden ? 1 : 0;
      fields.hidden = v as 0 | 1;
    }
    if (body.current_hp !== undefined) {
      if (body.current_hp === null) fields.currentHp = null;
      else {
        const n = numField('current_hp');
        if (n === null) return res.status(400).json({ error: 'current_hp must be number|null' });
        fields.currentHp = n;
      }
    }
    if (body.max_hp !== undefined) {
      if (body.max_hp === null) fields.maxHp = null;
      else {
        const n = numField('max_hp');
        if (n === null) return res.status(400).json({ error: 'max_hp must be number|null' });
        fields.maxHp = n;
      }
    }
    if (body.conditions !== undefined) {
      if (!Array.isArray(body.conditions) || body.conditions.some((c) => typeof c !== 'string'))
        return res.status(400).json({ error: 'conditions must be string[]' });
      fields.conditions = body.conditions as string[];
    }
    if (body.hp_visible_to_players !== undefined) {
      fields.hpVisibleToPlayers = (body.hp_visible_to_players ? 1 : 0) as 0 | 1;
    }
    if (body.x !== undefined) {
      const n = numField('x');
      if (n === null) return res.status(400).json({ error: 'x must be number' });
      fields.x = n;
    }
    if (body.y !== undefined) {
      const n = numField('y');
      if (n === null) return res.status(400).json({ error: 'y must be number' });
      fields.y = n;
    }
    if (body.z_index !== undefined) {
      if (!Number.isInteger(body.z_index))
        return res.status(400).json({ error: 'z_index must be int' });
      fields.zIndex = body.z_index as number;
    }
    try {
      const updated = updateToken(deps.db, id, fields);
      broadcastTokenEvent(deps.io, deps.db, 'token:updated', updated);
      return res.json({ token: payloadForDm(deps.db, updated.id) });
    } catch (e) {
      if (e instanceof TokenError && e.code === 'NOT_FOUND')
        return res.status(404).json({ error: e.message });
      if (e instanceof TokenError) return res.status(400).json({ error: e.message });
      throw e;
    }
  });

  r.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const existing = findTokenById(deps.db, id);
    if (!existing) return res.status(404).json({ error: 'not found' });
    try {
      deleteToken(deps.db, id);
      // Synthesize a delete event by emitting directly (no token row to filter against now).
      deps.io.emit('token:deleted', { id, page_id: existing.pageId });
      return res.status(204).end();
    } catch (e) {
      if (e instanceof TokenError && e.code === 'NOT_FOUND')
        return res.status(404).json({ error: e.message });
      throw e;
    }
  });

  return r;
}
