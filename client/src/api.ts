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

export interface Token {
  id: number;
  page_id: number;
  asset_id: number;
  asset_url: string;
  asset_thumb_url: string;
  name: string | null;
  x: number;
  y: number;
  size_squares: number;
  owner_player_id: number | null;
  conditions: string[];
  z_index: number;
  hidden?: 0 | 1;
  hp_visible_to_players?: 0 | 1;
  current_hp?: number | null;
  max_hp?: number | null;
}

export async function listTokenAssets(): Promise<ApiAsset[]> {
  const res = await fetch('/api/dm/assets?kind=token', { credentials: 'include' });
  if (!res.ok) throw new Error(`listTokenAssets failed: ${res.status}`);
  const body = await res.json();
  return body.assets;
}

export async function uploadTokenAsset(file: File): Promise<ApiAsset> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', 'token');
  const res = await fetch('/api/dm/assets/upload', {
    method: 'POST', credentials: 'include', body: fd,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `upload failed: ${res.status}`);
  }
  const body = await res.json();
  return body.asset;
}

export interface DeleteAssetConflict {
  references: {
    pages: { id: number; name: string }[];
    tokens: { id: number; name: string | null; pageId: number }[];
  };
}

export async function deleteAsset(id: number): Promise<void> {
  const res = await fetch(`/api/dm/assets/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.status === 204) return;
  if (res.status === 409) {
    const body = (await res.json()) as DeleteAssetConflict;
    const err = new Error('asset is in use') as Error & DeleteAssetConflict;
    err.references = body.references;
    throw err;
  }
  throw new Error(`deleteAsset failed: ${res.status}`);
}

export async function listTokens(pageId: number): Promise<Token[]> {
  const res = await fetch(`/api/dm/tokens?page_id=${pageId}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`listTokens failed: ${res.status}`);
  const body = await res.json();
  return body.tokens;
}

export async function createToken(input: {
  page_id: number; asset_id: number; x: number; y: number;
  size_squares?: number; name?: string | null;
}): Promise<Token> {
  const res = await fetch('/api/dm/tokens', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `createToken failed: ${res.status}`);
  }
  const body = await res.json();
  return body.token;
}

export async function patchToken(id: number, patch: Partial<{
  name: string | null; owner_player_id: number | null; size_squares: number;
  hidden: 0 | 1; current_hp: number | null; max_hp: number | null;
  conditions: string[]; hp_visible_to_players: 0 | 1; x: number; y: number; z_index: number;
}>): Promise<Token> {
  const res = await fetch(`/api/dm/tokens/${id}`, {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `patchToken failed: ${res.status}`);
  }
  const body = await res.json();
  return body.token;
}

export async function deleteToken(id: number): Promise<void> {
  const res = await fetch(`/api/dm/tokens/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.status !== 204) throw new Error(`deleteToken failed: ${res.status}`);
}

export async function patchPage(id: number, patch: Partial<{
  name: string; background_asset_id: number | null;
  grid_width_squares: number; grid_height_squares: number; sort_order: number;
}>): Promise<ApiPage> {
  const res = await fetch(`/api/dm/pages/${id}`, {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`patchPage failed: ${res.status}`);
  const body = await res.json();
  return body.page;
}
