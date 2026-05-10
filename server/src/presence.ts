export interface Presence {
  connect(playerId: number, socketId: string): { firstSocket: boolean };
  disconnect(playerId: number, socketId: string): { lastSocket: boolean };
  onlinePlayerIds(): number[];
  isOnline(playerId: number): boolean;
}

export function createPresence(): Presence {
  const sockets = new Map<number, Set<string>>();

  return {
    connect(playerId, socketId) {
      let set = sockets.get(playerId);
      const firstSocket = !set || set.size === 0;
      if (!set) {
        set = new Set();
        sockets.set(playerId, set);
      }
      set.add(socketId);
      return { firstSocket };
    },

    disconnect(playerId, socketId) {
      const set = sockets.get(playerId);
      if (!set || !set.has(socketId)) return { lastSocket: false };
      set.delete(socketId);
      if (set.size === 0) {
        sockets.delete(playerId);
        return { lastSocket: true };
      }
      return { lastSocket: false };
    },

    onlinePlayerIds() {
      return Array.from(sockets.keys());
    },

    isOnline(playerId) {
      return sockets.has(playerId);
    },
  };
}
