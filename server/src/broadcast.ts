import type Database from 'better-sqlite3';
import { findAssetById } from './db/assets.js';
import { findActivePage, type Page } from './db/pages.js';
import type { AppSocketIOServer } from './socket.js';

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
