import { describe, it, expect } from 'vitest';
import { createPresence } from '../server/src/presence.js';

describe('presence', () => {
  it('first socket for a player returns firstSocket: true', () => {
    const p = createPresence();
    expect(p.connect(1, 'sock-a')).toEqual({ firstSocket: true });
    expect(p.onlinePlayerIds()).toEqual([1]);
    expect(p.isOnline(1)).toBe(true);
  });

  it('second socket for the same player returns firstSocket: false', () => {
    const p = createPresence();
    p.connect(1, 'sock-a');
    expect(p.connect(1, 'sock-b')).toEqual({ firstSocket: false });
    expect(p.onlinePlayerIds()).toEqual([1]);
  });

  it('disconnecting one of two sockets does not mark the player offline', () => {
    const p = createPresence();
    p.connect(1, 'sock-a');
    p.connect(1, 'sock-b');
    expect(p.disconnect(1, 'sock-a')).toEqual({ lastSocket: false });
    expect(p.isOnline(1)).toBe(true);
  });

  it('disconnecting the last socket returns lastSocket: true and removes the player', () => {
    const p = createPresence();
    p.connect(1, 'sock-a');
    expect(p.disconnect(1, 'sock-a')).toEqual({ lastSocket: true });
    expect(p.isOnline(1)).toBe(false);
    expect(p.onlinePlayerIds()).toEqual([]);
  });

  it('disconnect for an unknown player is a no-op', () => {
    const p = createPresence();
    expect(p.disconnect(42, 'sock-x')).toEqual({ lastSocket: false });
    expect(p.onlinePlayerIds()).toEqual([]);
  });

  it('disconnect for a known player with an unknown socket is a no-op', () => {
    const p = createPresence();
    p.connect(1, 'sock-a');
    expect(p.disconnect(1, 'sock-ghost')).toEqual({ lastSocket: false });
    expect(p.isOnline(1)).toBe(true);
  });

  it('onlinePlayerIds returns ids in insertion order', () => {
    const p = createPresence();
    p.connect(2, 'a');
    p.connect(1, 'b');
    p.connect(3, 'c');
    expect(p.onlinePlayerIds()).toEqual([2, 1, 3]);
  });
});
