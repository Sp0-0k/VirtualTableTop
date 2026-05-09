import { create } from 'zustand';
import type { ApiPage } from './dmStore.js';
import type { Token, Player, FogStroke } from '../api.js';

interface PlayerState {
  activePage: ApiPage | null;
  myPlayerId: number | null;
  tokens: Record<number, Token>;
  players: Player[];
  dragging: Record<number, { x: number; y: number }>;
  incomingMove: Record<number, { x: number; y: number }>;

  setActivePage: (p: ApiPage | null) => void;
  setMyPlayerId: (id: number) => void;
  setTokens: (tokens: Token[]) => void;
  upsertToken: (t: Token) => void;
  removeToken: (id: number) => void;
  setPlayers: (p: Player[]) => void;
  setDragging: (id: number, pos: { x: number; y: number }) => void;
  clearDragging: (id: number) => void;
  setIncomingMove: (id: number, pos: { x: number; y: number }) => void;
  clearIncomingMove: (id: number) => void;
  activePageStrokes: FogStroke[];
  setActivePageStrokes: (strokes: FogStroke[]) => void;
  appendActivePageStroke: (s: FogStroke) => void;
  clearActivePageStrokes: () => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  activePage: null,
  myPlayerId: null,
  tokens: {},
  players: [],
  dragging: {},
  incomingMove: {},
  activePageStrokes: [],

  setActivePage: (activePage) => set({ activePage }),
  setMyPlayerId: (myPlayerId) => set({ myPlayerId }),
  setTokens: (tokens) => set({
    tokens: Object.fromEntries(tokens.map((t) => [t.id, t])),
  }),
  upsertToken: (t) => set((s) => ({ tokens: { ...s.tokens, [t.id]: t } })),
  removeToken: (id) => set((s) => {
    const { [id]: _drop, ...rest } = s.tokens;
    return { tokens: rest };
  }),
  setPlayers: (players) => set({ players }),
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
  setActivePageStrokes: (activePageStrokes) => set({ activePageStrokes }),
  appendActivePageStroke: (s) =>
    set((st) => ({ activePageStrokes: [...st.activePageStrokes, s] })),
  clearActivePageStrokes: () => set({ activePageStrokes: [] }),
}));
