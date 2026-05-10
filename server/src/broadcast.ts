import type Database from 'better-sqlite3';
import type { Server as SocketIOServer } from 'socket.io';
import { findAssetById } from './db/assets.js';
import { listFogStrokesByPage, type FogStroke } from './db/fog-strokes.js';
import { findActivePage, type Page } from './db/pages.js';
import { listPlayersForSync } from './db/players.js';
import type { Presence } from './presence.js';
import type { AppSocketIOServer } from './socket.js';
import type { Token } from './db/tokens.js';
import { listTokensByPage } from './db/tokens.js';

export interface SocketLike {
  data: { role: 'dm' | 'player'; name: string; playerId: number | null };
}

type IoLike = Pick<SocketIOServer, 'sockets'>;

export interface FogStrokePayload {
  id: number;
  page_id: number;
  mode: 'reveal' | 'hide';
  shape: 'brush' | 'rect';
  points: [number, number][];
  radius: number;
  created_at: number;
}

export interface PagePayload {
  id: number;
  name: string;
  background_asset_id: number | null;
  background_url: string | null;
  grid_width_squares: number;
  grid_height_squares: number;
  sort_order: number;
  is_active: 0 | 1;
  strokes?: FogStrokePayload[];
}

export interface FullSyncPayload {
  activePage: PagePayload | null;
  tokens: TokenPayload[];
  players: { id: number; name: string; color: string }[];
  online_player_ids: number[];
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

export function fogStrokeToPayload(s: FogStroke): FogStrokePayload {
  return {
    id: s.id,
    page_id: s.pageId,
    mode: s.mode,
    shape: s.shape,
    points: s.points,
    radius: s.radius,
    created_at: s.createdAt,
  };
}

export interface FogBroadcastPayload {
  page_id: number;
  [k: string]: unknown;
}

export function fogPayloadFor<T extends FogBroadcastPayload>(
  socket: SocketLike,
  payload: T,
  activePageId: number | null,
): T | null {
  if (socket.data.role === 'dm') return payload;
  if (activePageId === null) return null;
  if (payload.page_id === activePageId) return payload;
  return null;
}

export function broadcastFogEvent(
  io: IoLike,
  event: 'fog:stroking' | 'fog:stroke_added' | 'fog:cleared',
  payload: FogBroadcastPayload,
  activePageId: number | null,
  opts?: { skipSocketId?: string },
): void {
  for (const socket of io.sockets.sockets.values()) {
    if (opts?.skipSocketId && socket.id === opts.skipSocketId) continue;
    const sockLike = socket as unknown as SocketLike;
    if (event === 'fog:stroking') {
      // DM tabs only — never broadcast preview to players.
      if (sockLike.data.role !== 'dm') continue;
      socket.emit(event, payload);
      continue;
    }
    const filtered = fogPayloadFor(sockLike, payload, activePageId);
    if (filtered === null) continue;
    socket.emit(event, filtered);
  }
}

export function buildFullSync(
  db: Database.Database,
  socket: SocketLike,
  presence: Presence,
): FullSyncPayload {
  const active = findActivePage(db);
  const online_player_ids = presence.onlinePlayerIds();
  if (!active) return { activePage: null, tokens: [], players: [], online_player_ids };
  const pagePayload = resolvePageWithUrl(db, active);
  pagePayload.strokes = listFogStrokesByPage(db, active.id).map(fogStrokeToPayload);
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
  return { activePage: pagePayload, tokens, players, online_player_ids };
}

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
