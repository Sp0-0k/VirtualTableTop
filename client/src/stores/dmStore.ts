import { create } from 'zustand';
import type { Token, Player } from '../api.js';

export interface ApiAsset {
  id: number;
  hash: string;
  kind: 'map' | 'token';
  originalName: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
  uploadedAt: number;
}

export interface ApiPage {
  id: number;
  name: string;
  background_asset_id: number | null;
  background_url: string | null;
  grid_width_squares: number;
  grid_height_squares: number;
  sort_order: number;
  is_active: 0 | 1;
}

interface DmState {
  assets: ApiAsset[];
  pages: ApiPage[];
  selectedPageId: number | null;
  activePageId: number | null;
  tokens: Record<number, Token>;
  players: Player[];
  selectedTokenId: number | null;
  dragging: Record<number, { x: number; y: number }>;
  incomingMove: Record<number, { x: number; y: number }>;

  setAssets: (a: ApiAsset[]) => void;
  upsertAsset: (a: ApiAsset) => void;
  setPages: (p: ApiPage[]) => void;
  upsertPage: (p: ApiPage) => void;
  removePage: (id: number) => void;
  selectPage: (id: number | null) => void;
  setActivePageId: (id: number | null) => void;
  setTokens: (tokens: Token[]) => void;
  upsertToken: (t: Token) => void;
  removeToken: (id: number) => void;
  setPlayers: (p: Player[]) => void;
  selectToken: (id: number | null) => void;
  setDragging: (id: number, pos: { x: number; y: number }) => void;
  clearDragging: (id: number) => void;
  setIncomingMove: (id: number, pos: { x: number; y: number }) => void;
  clearIncomingMove: (id: number) => void;
}

export const useDmStore = create<DmState>((set) => ({
  assets: [],
  pages: [],
  selectedPageId: null,
  activePageId: null,
  tokens: {},
  players: [],
  selectedTokenId: null,
  dragging: {},
  incomingMove: {},

  setAssets: (assets) => set({ assets }),
  upsertAsset: (asset) =>
    set((s) => {
      const idx = s.assets.findIndex((a) => a.id === asset.id);
      const next = [...s.assets];
      if (idx === -1) next.unshift(asset);
      else next[idx] = asset;
      return { assets: next };
    }),

  setPages: (pages) =>
    set({
      pages,
      activePageId: pages.find((p) => p.is_active === 1)?.id ?? null,
    }),
  upsertPage: (page) =>
    set((s) => {
      const idx = s.pages.findIndex((p) => p.id === page.id);
      let nextPages: ApiPage[];
      if (idx === -1) {
        nextPages = [...s.pages, page].sort((a, b) => a.sort_order - b.sort_order);
      } else {
        nextPages = [...s.pages];
        nextPages[idx] = page;
      }
      // If this page is the active one, clear is_active on others.
      if (page.is_active === 1) {
        nextPages = nextPages.map((p) =>
          p.id === page.id ? p : { ...p, is_active: 0 },
        );
      }
      return {
        pages: nextPages,
        activePageId: nextPages.find((p) => p.is_active === 1)?.id ?? null,
      };
    }),
  removePage: (id) =>
    set((s) => ({
      pages: s.pages.filter((p) => p.id !== id),
      selectedPageId: s.selectedPageId === id ? null : s.selectedPageId,
      activePageId: s.activePageId === id ? null : s.activePageId,
    })),
  selectPage: (id) => set({ selectedPageId: id }),
  setActivePageId: (id) =>
    set((s) => ({
      activePageId: id,
      pages: s.pages.map((p) => ({ ...p, is_active: p.id === id ? 1 : 0 })),
    })),

  setTokens: (tokens) => set({
    tokens: Object.fromEntries(tokens.map((t) => [t.id, t])),
  }),
  upsertToken: (t) => set((s) => ({ tokens: { ...s.tokens, [t.id]: t } })),
  removeToken: (id) => set((s) => {
    const { [id]: _drop, ...rest } = s.tokens;
    return { tokens: rest, selectedTokenId: s.selectedTokenId === id ? null : s.selectedTokenId };
  }),
  setPlayers: (players) => set({ players }),
  selectToken: (selectedTokenId) => set({ selectedTokenId }),
  setDragging: (id, pos) => set((s) => ({ dragging: { ...s.dragging, [id]: pos } })),
  clearDragging: (id) => set((s) => {
    const { [id]: _drop, ...rest } = s.dragging;
    return { dragging: rest };
  }),
  setIncomingMove: (id, pos) => set((s) => ({ incomingMove: { ...s.incomingMove, [id]: pos } })),
  clearIncomingMove: (id) => set((s) => {
    const { [id]: _drop, ...rest } = s.incomingMove;
    return { incomingMove: rest };
  }),
}));
