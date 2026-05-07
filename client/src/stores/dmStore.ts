import { create } from 'zustand';

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

  setAssets: (a: ApiAsset[]) => void;
  upsertAsset: (a: ApiAsset) => void;
  setPages: (p: ApiPage[]) => void;
  upsertPage: (p: ApiPage) => void;
  removePage: (id: number) => void;
  selectPage: (id: number | null) => void;
  setActivePageId: (id: number | null) => void;
}

export const useDmStore = create<DmState>((set) => ({
  assets: [],
  pages: [],
  selectedPageId: null,
  activePageId: null,

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
}));
