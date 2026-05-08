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

  // Suppress unused-import warnings for deleteToken and updateToken
  // (they will be used in Task 7)
  void deleteToken;
  void updateToken;

  return r;
}
