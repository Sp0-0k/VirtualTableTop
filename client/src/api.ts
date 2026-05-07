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

export async function listMapAssets(): Promise<ApiAsset[]> {
  const res = await fetch('/api/dm/assets?kind=map', { credentials: 'include' });
  if (!res.ok) throw new Error(`listMapAssets failed: ${res.status}`);
  const body = await res.json();
  return body.assets;
}

export async function uploadMapAsset(file: File): Promise<ApiAsset> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', 'map');
  const res = await fetch('/api/dm/assets/upload', {
    method: 'POST',
    credentials: 'include',
    body: fd,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `upload failed: ${res.status}`);
  }
  const body = await res.json();
  return body.asset;
}

export async function listPages(): Promise<ApiPage[]> {
  const res = await fetch('/api/dm/pages', { credentials: 'include' });
  if (!res.ok) throw new Error(`listPages failed: ${res.status}`);
  const body = await res.json();
  return body.pages;
}

export interface CreatePageBody {
  name: string;
  background_asset_id: number | null;
  grid_width_squares: number;
  grid_height_squares: number;
}

export async function createPage(body: CreatePageBody): Promise<ApiPage> {
  const res = await fetch('/api/dm/pages', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error ?? `createPage failed: ${res.status}`);
  }
  const json = await res.json();
  return json.page;
}

export async function deletePage(id: number): Promise<void> {
  const res = await fetch(`/api/dm/pages/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (res.status === 204) return;
  const body = await res.json().catch(() => ({}));
  throw new Error(body.error ?? `deletePage failed: ${res.status}`);
}

export async function setActivePage(id: number): Promise<ApiPage> {
  const res = await fetch(`/api/dm/pages/${id}/set-active`, {
    method: 'PUT',
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `setActivePage failed: ${res.status}`);
  }
  const body = await res.json();
  return body.page;
}
