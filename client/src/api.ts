export interface Player {
  id: number;
  name: string;
  color: string;
  createdAt: number;
  lastSeenAt: number | null;
}

export type Me =
  | { role: 'anon' }
  | { role: 'dm' }
  | { role: 'player'; player: Player };

export async function getMe(): Promise<Me> {
  const res = await fetch('/api/me', { credentials: 'include' });
  if (!res.ok) throw new Error(`/api/me failed: ${res.status}`);
  return res.json();
}

export async function bootstrapDm(): Promise<void> {
  const res = await fetch('/api/dm/bootstrap', { credentials: 'include' });
  if (!res.ok) throw new Error(`/api/dm/bootstrap failed: ${res.status}`);
}

export async function joinAsPlayer(name: string, color: string): Promise<Player> {
  const res = await fetch('/api/player/join', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `join failed: ${res.status}`);
  }
  const body = await res.json();
  return body.player;
}
