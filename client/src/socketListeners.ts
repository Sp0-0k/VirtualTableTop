import type { Socket } from 'socket.io-client';
import type { Token, Player, ApiPage, ApiAsset } from './api.js';

interface FullSyncPayload {
  activePage: ApiPage | null;
  tokens: Token[];
  players: Player[];
}

export interface DmHandlers {
  onFullSync: (p: FullSyncPayload) => void;
  onActivePageChanged: (p: { activePage: ApiPage | null }) => void;
  onPageCreated: (p: { page: ApiPage }) => void;
  onPageUpdated: (p: { page: ApiPage }) => void;
  onPageDeleted: (p: { id: number }) => void;
  onAssetCreated: (p: { asset: ApiAsset }) => void;
  onAssetDeleted: (p: { id: number; kind: 'map' | 'token' }) => void;
  onTokenCreated: (p: Token) => void;
  onTokenUpdated: (p: Token) => void;
  onTokenDeleted: (p: { id: number; page_id: number }) => void;
  onTokenMoving: (p: { id: number; x: number; y: number; by?: number | 'dm' }) => void;
  onTokenMoved: (p: { id: number; x: number; y: number }) => void;
}

export function attachDmListeners(socket: Socket, h: DmHandlers): () => void {
  const wired: [string, (...args: unknown[]) => void][] = [
    ['state:full_sync', h.onFullSync as never],
    ['state:active_page_changed', h.onActivePageChanged as never],
    ['page:created', h.onPageCreated as never],
    ['page:updated', h.onPageUpdated as never],
    ['page:deleted', h.onPageDeleted as never],
    ['asset:created', h.onAssetCreated as never],
    ['asset:deleted', h.onAssetDeleted as never],
    ['token:created', h.onTokenCreated as never],
    ['token:updated', h.onTokenUpdated as never],
    ['token:deleted', h.onTokenDeleted as never],
    ['token:moving', h.onTokenMoving as never],
    ['token:moved', h.onTokenMoved as never],
  ];
  for (const [evt, fn] of wired) socket.on(evt, fn);
  return () => { for (const [evt, fn] of wired) socket.off(evt, fn); };
}

export interface PlayerHandlers {
  onFullSync: (p: FullSyncPayload) => void;
  onActivePageChanged: (p: { activePage: ApiPage | null }) => void;
  onTokenCreated: (p: Token) => void;
  onTokenUpdated: (p: Token) => void;
  onTokenDeleted: (p: { id: number; page_id: number }) => void;
  onTokenMoving: (p: { id: number; x: number; y: number; by?: number | 'dm' }) => void;
  onTokenMoved: (p: { id: number; x: number; y: number }) => void;
}

export function attachPlayerListeners(socket: Socket, h: PlayerHandlers): () => void {
  const wired: [string, (...args: unknown[]) => void][] = [
    ['state:full_sync', h.onFullSync as never],
    ['state:active_page_changed', h.onActivePageChanged as never],
    ['token:created', h.onTokenCreated as never],
    ['token:updated', h.onTokenUpdated as never],
    ['token:deleted', h.onTokenDeleted as never],
    ['token:moving', h.onTokenMoving as never],
    ['token:moved', h.onTokenMoved as never],
  ];
  for (const [evt, fn] of wired) socket.on(evt, fn);
  return () => { for (const [evt, fn] of wired) socket.off(evt, fn); };
}
