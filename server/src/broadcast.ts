import type Database from 'better-sqlite3';
import type { Server as SocketIOServer } from 'socket.io';
import { findAssetById } from './db/assets.js';
import { findActivePage, type Page } from './db/pages.js';
import type { AppSocketIOServer } from './socket.js';
import type { Token } from './db/tokens.js';
import { listTokensByPage } from './db/tokens.js';
import { listPlayersForSync } from './db/players.js';

export interface PagePayload {
  id: number;
  name: string;
  background_asset_id: number | null;
  background_url: string | null;
  grid_width_squares: number;
  grid_height_squares: number;
  sort_order: number;
  is_active: 0 | 1;
}

export interface FullSyncPayload {
  activePage: PagePayload | null;
  tokens: TokenPayload[];
  players: { id: number; name: string; color: string }[];
}

export function resolvePageWithUrl(db: Database.Database, page: Page): PagePayload {
  let url: string | null = null;
  if (page.backgroundAssetId !== null) {
    const asset = findAssetById(db, page.backgroundAssetId);
    if (asset) url = `/assets/${asset.hash}.webp`;
  }
  return {
    id: page.id,
    name: page.name,
    background_asset_id: page.backgroundAssetId,
    background_url: url,
    grid_width_squares: page.gridWidthSquares,
    grid_height_squares: page.gridHeightSquares,
    sort_order: page.sortOrder,
    is_active: page.isActive,
  };
}

export function buildFullSync(db: Database.Database, socket: SocketLike): FullSyncPayload {
  const active = findActivePage(db);
  if (!active) return { activePage: null, tokens: [], players: [] };
  const pagePayload = resolvePageWithUrl(db, active);
  const players = listPlayersForSync(db);
  const rawTokens = listTokensByPage(db, active.id);
  const tokens: TokenPayload[] = [];
  for (const t of rawTokens) {
    const asset = findAssetById(db, t.assetId);
    if (!asset) continue;
    const url = `/assets/${asset.hash}.webp`;
    const thumb = `/assets/${asset.hash}.thumb.webp`;
    const filtered = tokenForSocket(t, socket, url, thumb);
    if (filtered) tokens.push(filtered);
  }
  return { activePage: pagePayload, tokens, players };
}

type IoLike = Pick<SocketIOServer, 'sockets'>;

export function broadcastTokenEvent(
  io: IoLike,
  db: Database.Database,
  event: 'token:created' | 'token:updated' | 'token:moved' | 'token:moving' | 'token:deleted',
  token: Token,
  opts?: { skipSocketId?: string },
): void {
  const asset = findAssetById(db, token.assetId);
  const url = asset ? `/assets/${asset.hash}.webp` : '';
  const thumb = asset ? `/assets/${asset.hash}.thumb.webp` : '';
  for (const socket of io.sockets.sockets.values()) {
    if (opts?.skipSocketId && socket.id === opts.skipSocketId) continue;
    const sockLike = socket as unknown as SocketLike;
    const payload = tokenForSocket(token, sockLike, url, thumb);
    if (payload === null) {
      if (event === 'token:updated') {
        socket.emit('token:deleted', { id: token.id, page_id: token.pageId });
      }
      continue;
    }
    socket.emit(event, payload);
  }
}

export function broadcastActivePageChanged(
  io: AppSocketIOServer,
  page: PagePayload | null,
): void {
  io.emit('state:active_page_changed', { activePage: page });
}

export interface TokenPayload {
  id: number;
  page_id: number;
  asset_id: number;
  asset_url: string;
  asset_thumb_url: string;
  name: string | null;
  x: number;
  y: number;
  size_squares: number;
  owner_player_id: number | null;
  conditions: string[];
  z_index: number;
  // DM-only
  hidden?: 0 | 1;
  hp_visible_to_players?: 0 | 1;
  // HP fields — undefined when filtered for hp-hidden
  current_hp?: number | null;
  max_hp?: number | null;
}

export interface SocketLike {
  data: { role: 'dm' | 'player'; name: string; playerId: number | null };
}

export function tokenForSocket(
  token: Token,
  socket: SocketLike,
  assetUrl: string,
  assetThumbUrl: string,
): TokenPayload | null {
  if (socket.data.role === 'dm') {
    return {
      id: token.id,
      page_id: token.pageId,
      asset_id: token.assetId,
      asset_url: assetUrl,
      asset_thumb_url: assetThumbUrl,
      name: token.name,
      x: token.x,
      y: token.y,
      size_squares: token.sizeSquares,
      owner_player_id: token.ownerPlayerId,
      hidden: token.hidden,
      current_hp: token.currentHp,
      max_hp: token.maxHp,
      conditions: token.conditions,
      hp_visible_to_players: token.hpVisibleToPlayers,
      z_index: token.zIndex,
    };
  }
  // player
  if (token.hidden) return null;
  const out: TokenPayload = {
    id: token.id,
    page_id: token.pageId,
    asset_id: token.assetId,
    asset_url: assetUrl,
    asset_thumb_url: assetThumbUrl,
    name: token.name,
    x: token.x,
    y: token.y,
    size_squares: token.sizeSquares,
    owner_player_id: token.ownerPlayerId,
    conditions: token.conditions,
    z_index: token.zIndex,
  };
  if (token.hpVisibleToPlayers) {
    out.current_hp = token.currentHp;
    out.max_hp = token.maxHp;
  }
  return out;
}
