import { create } from 'zustand';
import type { ApiPage } from './dmStore.js';

interface PlayerState {
  activePage: ApiPage | null;
  setActivePage: (p: ApiPage | null) => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  activePage: null,
  setActivePage: (activePage) => set({ activePage }),
}));
