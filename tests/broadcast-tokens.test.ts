import { describe, it, expect } from 'vitest';
import { tokenForSocket, type SocketLike } from '../server/src/broadcast.js';
import type { Token } from '../server/src/db/tokens.js';

const baseToken: Token = {
  id: 1, pageId: 1, assetId: 1, name: 'Goblin',
  x: 0, y: 0, sizeSquares: 1, ownerPlayerId: null,
  hidden: 0, currentHp: 5, maxHp: 10,
  conditions: ['poisoned'], hpVisibleToPlayers: 1, zIndex: 0,
};

const dmSocket: SocketLike = { data: { role: 'dm', name: 'DM', playerId: null } };
const playerSocket: SocketLike = { data: { role: 'player', name: 'Alice', playerId: 7 } };

describe('tokenForSocket', () => {
  it('returns full record for DM', () => {
    const out = tokenForSocket(baseToken, dmSocket, '/assets/h.webp', '/assets/h.thumb.webp');
    expect(out).not.toBeNull();
    expect(out!.hidden).toBe(0);
    expect(out!.current_hp).toBe(5);
    expect(out!.hp_visible_to_players).toBe(1);
  });

  it('returns null for player when token is hidden', () => {
    expect(
      tokenForSocket(
        { ...baseToken, hidden: 1 },
        playerSocket,
        '/assets/h.webp',
        '/assets/h.thumb.webp',
      ),
    ).toBeNull();
  });

  it('strips HP fields when hpVisibleToPlayers=0 for player', () => {
    const out = tokenForSocket(
      { ...baseToken, hpVisibleToPlayers: 0 },
      playerSocket,
      '/assets/h.webp',
      '/assets/h.thumb.webp',
    );
    expect(out).not.toBeNull();
    expect(out!.current_hp).toBeUndefined();
    expect(out!.max_hp).toBeUndefined();
  });

  it('returns full HP for player when hpVisibleToPlayers=1', () => {
    const out = tokenForSocket(baseToken, playerSocket, '/assets/h.webp', '/assets/h.thumb.webp');
    expect(out!.current_hp).toBe(5);
    expect(out!.max_hp).toBe(10);
  });

  it('omits DM-only meta fields from player payload', () => {
    const out = tokenForSocket(baseToken, playerSocket, '/assets/h.webp', '/assets/h.thumb.webp');
    expect(out!.hidden).toBeUndefined();
    expect(out!.hp_visible_to_players).toBeUndefined();
  });
});
