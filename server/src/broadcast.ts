import type Database from 'better-sqlite3';
import { findAssetById } from './db/assets.js';
import { findActivePage, type Page } from './db/pages.js';
import type { AppSocketIOServer } from './socket.js';
import type { Token } from './db/tokens.js';

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

export function buildFullSync(db: Database.Database): FullSyncPayload {
  const active = findActivePage(db);
  return { activePage: active ? resolvePageWithUrl(db, active) : null };
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
