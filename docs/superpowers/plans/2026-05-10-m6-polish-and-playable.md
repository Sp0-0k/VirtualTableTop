# M6 — Polish & Playable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the polish layer that makes the VTT ready for a real session: real-time presence, error toasts, a disconnect indicator, and a verified reconnection path.

**Architecture:** A pure in-memory presence map on the server tracks player sockets and emits `player:joined` / `player:left` as the connected-socket set for each player transitions through 0. The full-sync payload gains an `online_player_ids: number[]` so any reconnecting client recovers the correct roster without depending on having received earlier presence events. The client gets a small toast store + host driven by the server's `error` event and a 3-second disconnect grace timer. Owner-color rings on tokens are already implemented in `TokenNode.tsx` — no new component needed.

**Tech Stack:** Server: Node 20 / Express / Socket.IO / better-sqlite3. Client: React 18 / Zustand / react-konva. Tests: vitest + supertest + socket.io-client; Playwright for e2e. Existing patterns are in `tests/socket.test.ts` (server) and `e2e/two-browser-sync.spec.ts` (e2e).

**Spec:** `docs/superpowers/specs/2026-05-10-m6-polish-and-playable.md`

**Note on error codes:** the spec lists codes `permission_denied` / `invalid_payload` / `not_found`. The existing code already emits `forbidden` / `bad_payload` / `not_found` from `server/src/socket/token-move.ts` and `server/src/socket/fog.ts`. This plan uses the existing names — no rename, just verify coverage in tests.

**Note on owner rings:** `client/src/canvas/TokenNode.tsx:60-64` already renders a per-token ring whose stroke is `player.color` for player-owned tokens. No new `OwnerRing.tsx` is needed. The plan keeps the existing visual behavior (grey dashed ring on DM-owned tokens). If you decide the spec's stricter "no ring at all for DM-owned" reading is desired, that's a one-line edit to `TokenNode.tsx` not currently scheduled.

---

## File Structure

### New files

```
server/src/presence.ts                  Presence map module (pure, in-memory)
client/src/toasts/store.ts              Zustand toast store + auto-expire
client/src/toasts/ToastHost.tsx         Top-right toast container, mounted at root
tests/presence.test.ts                  Unit tests for presence map
tests/socket-presence.test.ts           Integration: player:joined/left across sockets
e2e/reconnect-and-presence.spec.ts      Playwright: drop player socket, header drops & restores
```

### Modified files

```
server/src/socket.ts                    Instantiate Presence; wire connect/disconnect
                                        emit player:joined / player:left
                                        pass presence into buildFullSync
server/src/broadcast.ts                 +online_player_ids on FullSyncPayload;
                                        buildFullSync takes presence param
client/src/api.ts                       +online_player_ids: number[] on FullSyncPayload
client/src/socketListeners.ts           +onPlayerJoined / onPlayerLeft on both
                                        DmHandlers and PlayerHandlers
client/src/stores/dmStore.ts            +onlinePlayerIds slice
client/src/stores/playerStore.ts        +onlinePlayerIds slice
client/src/DmApp.tsx                    mount ToastHost; wire error + disconnect toasts;
                                        wire player:joined/left handlers;
                                        show online roster in header
client/src/PlayerApp.tsx                mount ToastHost; wire error + disconnect toasts;
                                        wire player:joined/left handlers;
                                        filter header roster by onlinePlayerIds
```

---

## Task 1: Presence Module (pure, TDD)

**Files:**
- Create: `server/src/presence.ts`
- Test: `tests/presence.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/presence.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/presence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```ts
// server/src/presence.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/presence.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/presence.ts tests/presence.test.ts
git commit -m "feat(server): presence map module with unit tests"
```

---

## Task 2: Extend `FullSyncPayload` with `online_player_ids`

**Files:**
- Modify: `server/src/broadcast.ts`
- Modify: `server/src/socket.ts`
- Test: `tests/broadcast.test.ts` (extend) or new assertions in `tests/socket.test.ts`

- [ ] **Step 1: Update the `FullSyncPayload` type and `buildFullSync` signature**

In `server/src/broadcast.ts`, add `online_player_ids` to the payload and change `buildFullSync` to accept a `Presence`:

```ts
// at the top, add:
import type { Presence } from './presence.js';

// update the interface:
export interface FullSyncPayload {
  activePage: PagePayload | null;
  tokens: TokenPayload[];
  players: { id: number; name: string; color: string }[];
  online_player_ids: number[];
}

// change buildFullSync to take presence:
export function buildFullSync(
  db: Database.Database,
  socket: SocketLike,
  presence: Presence,
): FullSyncPayload {
  const active = findActivePage(db);
  const online_player_ids = presence.onlinePlayerIds();
  if (!active) {
    return { activePage: null, tokens: [], players: [], online_player_ids };
  }
  const pagePayload = resolvePageWithUrl(db, active);
  pagePayload.strokes = listFogStrokesByPage(db, active.id).map(fogStrokeToPayload);
  const players = listPlayersForSync(db);
  const rawTokens = listTokensByPage(db, active.id);
  const tokens: TokenPayload[] = [];
  for (const t of rawTokens) {
    const asset = findAssetById(db, t.assetId);
    if (!asset) continue;
    const url = `/assets/${asset.hash}.webp`;
    const thumb = `/assets/${asset.hash}.thumb.webp`;
    const filtered = tokenForSocket(t, socket, url, thumb);
    if (filtered) tokens.push(filtered);
  }
  return { activePage: pagePayload, tokens, players, online_player_ids };
}
```

- [ ] **Step 2: Update `socket.ts` to instantiate Presence and pass it through**

```ts
// server/src/socket.ts
import { createPresence } from './presence.js';
// ... (existing imports)

export function attachSocketIO(httpServer: http.Server, deps: SocketDeps): AppSocketIOServer {
  const io: AppSocketIOServer = new SocketIOServer(httpServer, {
    cors: { origin: false },
  });

  const presence = createPresence();

  io.use((socket, next) => {
    // ... (existing auth middleware unchanged)
  });

  io.on('connection', (socket) => {
    if (socket.data.role === 'dm') socket.join('dm');
    socket.emit('session', socket.data);
    socket.emit('state:full_sync', buildFullSync(deps.db, socket, presence));
    registerTokenMoveHandlers(socket, io, deps.db);
    registerFogHandlers(socket, io, deps.db);
  });

  return io;
}
```

(Presence wiring of join/leave events comes in Task 3 — leave it out for now so this task compiles cleanly.)

- [ ] **Step 3: Update any other callers of `buildFullSync`**

Run: `grep -rn 'buildFullSync' server/src tests`

Update each callsite to pass a Presence instance. Likely callers: only `server/src/socket.ts` (production) and any tests that call it directly. For tests that call `buildFullSync` directly, instantiate a presence inline:

```ts
import { createPresence } from '../server/src/presence.js';
// ...
const result = buildFullSync(db, socketLike, createPresence());
```

- [ ] **Step 4: Add a test assertion that `state:full_sync` carries `online_player_ids`**

Append to `tests/socket.test.ts` inside the existing `describe('state:full_sync on connection', ...)`:

```ts
it('includes online_player_ids in the payload', async () => {
  const cookie = await joinAsPlayer(ts, 'Aria', '#aabbcc');
  const { client, payload } = await connectAndCapture<{
    online_player_ids: number[];
    players: { id: number; name: string }[];
  }>(ts.url, cookie, 'state:full_sync');
  // The player just connected, so their id should be in the array.
  const me = payload.players.find((p) => p.name === 'Aria')!;
  expect(payload.online_player_ids).toContain(me.id);
  client.close();
});
```

- [ ] **Step 5: Run server tests**

Run: `npx vitest run tests/`
Expected: existing tests still pass; new assertion passes.

- [ ] **Step 6: Type-check**

Run: `npx tsc -p tsconfig.server.json --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/src/broadcast.ts server/src/socket.ts tests/socket.test.ts tests/broadcast*.test.ts
git commit -m "feat(server): online_player_ids in state:full_sync"
```

(Adjust the `git add` line if no broadcast tests were modified.)

---

## Task 3: Emit `player:joined` and `player:left` from socket lifecycle

**Files:**
- Modify: `server/src/socket.ts`
- Test: `tests/socket-presence.test.ts` (new)

- [ ] **Step 1: Write the failing integration tests**

```ts
// tests/socket-presence.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { startTestServer, type TestServer } from './helpers/testServer.js';

async function joinAsPlayer(ts: TestServer, name: string, color: string): Promise<{ cookie: string; id: number }> {
  const res = await request(ts.server).post('/api/player/join').send({ name, color });
  const setCookie = res.headers['set-cookie'];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie!];
  const cookie = arr.map((c: string) => c.split(';')[0]).join('; ');
  return { cookie, id: res.body.player.id };
}

async function bootstrapDm(ts: TestServer): Promise<string> {
  const res = await request(ts.server).get('/api/dm/bootstrap');
  const setCookie = res.headers['set-cookie'];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie!];
  return arr.map((c: string) => c.split(';')[0]).join('; ');
}

function connectWithCookie(url: string, cookie: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const c = ioc(url, {
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
    });
    const t = setTimeout(() => { c.close(); reject(new Error('connect timeout')); }, 2000);
    c.on('connect', () => { clearTimeout(t); resolve(c); });
    c.on('connect_error', (err) => { clearTimeout(t); reject(err); });
  });
}

function waitForEvent<T>(sock: ClientSocket, event: string, timeoutMs = 1500): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    sock.once(event, (p: T) => { clearTimeout(t); resolve(p); });
  });
}

describe('presence broadcasts', () => {
  let ts: TestServer;
  beforeAll(async () => { ts = await startTestServer(); });
  afterAll(async () => { await ts.close(); });

  it('emits player:joined when a player connects for the first time', async () => {
    const dmCookie = await bootstrapDm(ts);
    const { cookie: pCookie, id: pId } = await joinAsPlayer(ts, 'Ari', '#abcdef');

    const dm = await connectWithCookie(ts.url, dmCookie);
    const joined = waitForEvent<{ playerId: number }>(dm, 'player:joined');
    const player = await connectWithCookie(ts.url, pCookie);
    await expect(joined).resolves.toEqual({ playerId: pId });

    dm.close();
    player.close();
  });

  it('does NOT emit player:joined for a second tab of the same player', async () => {
    const dmCookie = await bootstrapDm(ts);
    const { cookie: pCookie } = await joinAsPlayer(ts, 'Bri', '#abcdef');

    const player1 = await connectWithCookie(ts.url, pCookie);
    const dm = await connectWithCookie(ts.url, dmCookie);
    let secondJoinSeen = false;
    dm.on('player:joined', () => { secondJoinSeen = true; });
    const player2 = await connectWithCookie(ts.url, pCookie);

    // Give the server a tick to send the event if it were going to.
    await new Promise((r) => setTimeout(r, 200));
    expect(secondJoinSeen).toBe(false);

    player1.close();
    player2.close();
    dm.close();
  });

  it('emits player:left only when the last socket for a player disconnects', async () => {
    const dmCookie = await bootstrapDm(ts);
    const { cookie: pCookie, id: pId } = await joinAsPlayer(ts, 'Cas', '#abcdef');

    const player1 = await connectWithCookie(ts.url, pCookie);
    const player2 = await connectWithCookie(ts.url, pCookie);
    const dm = await connectWithCookie(ts.url, dmCookie);

    let leftSeen: { playerId: number } | null = null;
    dm.on('player:left', (p: { playerId: number }) => { leftSeen = p; });

    player1.close();
    await new Promise((r) => setTimeout(r, 200));
    expect(leftSeen).toBeNull();

    player2.close();
    await new Promise((r) => setTimeout(r, 200));
    expect(leftSeen).toEqual({ playerId: pId });

    dm.close();
  });

  it('DM connecting/disconnecting does not emit presence events', async () => {
    const dmCookie1 = await bootstrapDm(ts);
    const { cookie: pCookie } = await joinAsPlayer(ts, 'Dru', '#abcdef');

    const observer = await connectWithCookie(ts.url, pCookie);
    let sawJoin = false, sawLeft = false;
    observer.on('player:joined', () => { sawJoin = true; });
    observer.on('player:left', () => { sawLeft = true; });

    const dmCookie2 = await bootstrapDm(ts);
    const dm = await connectWithCookie(ts.url, dmCookie2);
    await new Promise((r) => setTimeout(r, 100));
    dm.close();
    await new Promise((r) => setTimeout(r, 200));

    expect(sawJoin).toBe(false);
    expect(sawLeft).toBe(false);

    observer.close();
    void dmCookie1; // unused; just here for symmetry
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/socket-presence.test.ts`
Expected: FAIL — events not emitted.

- [ ] **Step 3: Wire presence into the connection handler**

In `server/src/socket.ts`, expand the `io.on('connection', ...)` block:

```ts
io.on('connection', (socket) => {
  if (socket.data.role === 'dm') socket.join('dm');
  socket.emit('session', socket.data);
  socket.emit('state:full_sync', buildFullSync(deps.db, socket, presence));
  registerTokenMoveHandlers(socket, io, deps.db);
  registerFogHandlers(socket, io, deps.db);

  if (socket.data.role === 'player' && socket.data.playerId !== null) {
    const playerId = socket.data.playerId;
    const { firstSocket } = presence.connect(playerId, socket.id);
    if (firstSocket) io.emit('player:joined', { playerId });

    socket.on('disconnect', () => {
      const { lastSocket } = presence.disconnect(playerId, socket.id);
      if (lastSocket) io.emit('player:left', { playerId });
    });
  }
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/socket-presence.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run full server test suite**

Run: `npx vitest run tests/`
Expected: all pass (no regressions).

- [ ] **Step 6: Commit**

```bash
git add server/src/socket.ts tests/socket-presence.test.ts
git commit -m "feat(server): emit player:joined / player:left on socket lifecycle"
```

---

## Task 4: Client store slices for `onlinePlayerIds`

**Files:**
- Modify: `client/src/api.ts`
- Modify: `client/src/stores/dmStore.ts`
- Modify: `client/src/stores/playerStore.ts`

- [ ] **Step 1: Extend the `FullSyncPayload` type on the client**

Search for the existing definition: `grep -n "FullSyncPayload" client/src/`. It lives in `client/src/socketListeners.ts` as a local interface (not exported from `api.ts`). The type for the full-sync payload is referenced by both handler maps. Update the local interface in `socketListeners.ts`:

```ts
// client/src/socketListeners.ts (top — replace existing FullSyncPayload)
interface FullSyncPayload {
  activePage: ApiPage | null;
  tokens: Token[];
  players: Player[];
  online_player_ids: number[];
}
```

- [ ] **Step 2: Add the slice to `dmStore.ts`**

In `client/src/stores/dmStore.ts`, extend the state interface and initial values:

```ts
interface DmState {
  // ... existing fields
  onlinePlayerIds: Set<number>;

  // ... existing actions
  setOnlinePlayerIds: (ids: number[]) => void;
  markPlayerOnline: (id: number) => void;
  markPlayerOffline: (id: number) => void;
}
```

And in the `create<DmState>((set) => ({ ... }))` body:

```ts
  onlinePlayerIds: new Set<number>(),

  setOnlinePlayerIds: (ids) => set({ onlinePlayerIds: new Set(ids) }),
  markPlayerOnline: (id) =>
    set((s) => {
      const next = new Set(s.onlinePlayerIds);
      next.add(id);
      return { onlinePlayerIds: next };
    }),
  markPlayerOffline: (id) =>
    set((s) => {
      const next = new Set(s.onlinePlayerIds);
      next.delete(id);
      return { onlinePlayerIds: next };
    }),
```

- [ ] **Step 3: Add the same slice to `playerStore.ts`**

```ts
// in the state interface:
onlinePlayerIds: Set<number>;
setOnlinePlayerIds: (ids: number[]) => void;
markPlayerOnline: (id: number) => void;
markPlayerOffline: (id: number) => void;

// in the store body:
onlinePlayerIds: new Set<number>(),
setOnlinePlayerIds: (ids) => set({ onlinePlayerIds: new Set(ids) }),
markPlayerOnline: (id) =>
  set((s) => {
    const next = new Set(s.onlinePlayerIds);
    next.add(id);
    return { onlinePlayerIds: next };
  }),
markPlayerOffline: (id) =>
  set((s) => {
    const next = new Set(s.onlinePlayerIds);
    next.delete(id);
    return { onlinePlayerIds: next };
  }),
```

The existing `PlayerState` interface and `usePlayerStore` constructor pattern in `client/src/stores/playerStore.ts` match `dmStore.ts`; insert these fields/actions following the same shape.

- [ ] **Step 4: Type-check**

Run: `npx tsc -p tsconfig.client.json --noEmit`
Expected: clean. (Errors at this point would come from `onFullSync` not yet calling `setOnlinePlayerIds` — that's handled in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add client/src/socketListeners.ts client/src/stores/dmStore.ts client/src/stores/playerStore.ts
git commit -m "feat(client): onlinePlayerIds slice in DM + player stores"
```

---

## Task 5: Wire `player:joined` / `player:left` client listeners

**Files:**
- Modify: `client/src/socketListeners.ts`
- Modify: `client/src/DmApp.tsx`
- Modify: `client/src/PlayerApp.tsx`

- [ ] **Step 1: Extend the handler interfaces and listener wiring**

In `client/src/socketListeners.ts`, add to both `DmHandlers` and `PlayerHandlers`:

```ts
onPlayerJoined: (p: { playerId: number }) => void;
onPlayerLeft: (p: { playerId: number }) => void;
```

And add to the `wired` arrays in both `attachDmListeners` and `attachPlayerListeners`:

```ts
['player:joined', h.onPlayerJoined as never],
['player:left',   h.onPlayerLeft   as never],
```

- [ ] **Step 2: Implement handlers in `DmApp.tsx`**

In the `attachDmListeners(socket, { ... })` call inside the `useEffect`:

- Replace the existing `onFullSync` body to also set online ids:

```ts
onFullSync: (p) => {
  useDmStore.getState().setPlayers(p.players);
  useDmStore.getState().setTokens(p.tokens);
  useDmStore.getState().setActivePageStrokes(p.activePage?.strokes ?? []);
  useDmStore.getState().setOnlinePlayerIds(p.online_player_ids);
},
```

- Add the new handlers:

```ts
onPlayerJoined: ({ playerId }) => useDmStore.getState().markPlayerOnline(playerId),
onPlayerLeft:   ({ playerId }) => useDmStore.getState().markPlayerOffline(playerId),
```

- [ ] **Step 3: Implement handlers in `PlayerApp.tsx`**

Same pattern — extend `onFullSync`:

```ts
onFullSync: (p) => {
  usePlayerStore.getState().setActivePage(p.activePage);
  usePlayerStore.getState().setPlayers(p.players);
  usePlayerStore.getState().setTokens(p.tokens);
  usePlayerStore.getState().setActivePageStrokes(p.activePage?.strokes ?? []);
  usePlayerStore.getState().setOnlinePlayerIds(p.online_player_ids);
},
```

And add:

```ts
onPlayerJoined: ({ playerId }) => usePlayerStore.getState().markPlayerOnline(playerId),
onPlayerLeft:   ({ playerId }) => usePlayerStore.getState().markPlayerOffline(playerId),
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -p tsconfig.client.json --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/socketListeners.ts client/src/DmApp.tsx client/src/PlayerApp.tsx
git commit -m "feat(client): wire player:joined / player:left and online ids in full_sync"
```

---

## Task 6: Render online roster in headers

**Files:**
- Modify: `client/src/PlayerApp.tsx`
- Modify: `client/src/DmApp.tsx`

- [ ] **Step 1: Player view — filter the existing roster line by online ids**

In `client/src/PlayerApp.tsx`, replace the existing `otherPlayers` derivation:

```ts
const onlinePlayerIds = usePlayerStore((s) => s.onlinePlayerIds);
const otherPlayers = player
  ? players.filter((p) => p.id !== player.id && onlinePlayerIds.has(p.id))
  : [];
```

The existing JSX (`otherPlayers.length > 0 ? ... : 'you are alone'`) continues to work — it now shows only currently-online others.

- [ ] **Step 2: DM view — add an online list to the right side of the header**

In `client/src/DmApp.tsx`, near the other store selectors:

```ts
const onlinePlayerIds = useDmStore((s) => s.onlinePlayerIds);
const onlinePlayers = useMemo(
  () => players.filter((p) => onlinePlayerIds.has(p.id)),
  [players, onlinePlayerIds],
);
```

In the header JSX, add a span just before the closing `</header>` (alongside the Select/Fog buttons), placed left of them:

```tsx
<span style={{ marginLeft: 'auto', color: '#666', fontSize: '0.85rem' }}>
  {onlinePlayers.length === 0
    ? 'no players online'
    : onlinePlayers.map((p) => (
        <span key={p.id} style={{ marginRight: 8, color: p.color }}>{p.name}</span>
      ))}
</span>
```

Move the existing `<div style={{ marginLeft: 'auto', ... }}>` wrapping the Select/Fog buttons so it does *not* claim `marginLeft: 'auto'` (since the online roster now does). Replace that style with `marginLeft: 16` so the buttons sit just right of the roster.

- [ ] **Step 3: Smoke test in the browser**

Build the client and exercise both views.

Run: `npm run dev:server` (separate terminal), then `npm run dev:client`.

- Open `/dm` → header empty roster, says "no players online" (or whatever name appears once a player joins).
- Open `/` in a private window → pick a name → name appears in DM header in player's color, and disappears when the player tab closes.

(If you can't manually verify, that's fine — Task 12's e2e covers the path. Note in the handoff message that browser smoke was skipped.)

- [ ] **Step 4: Commit**

```bash
git add client/src/PlayerApp.tsx client/src/DmApp.tsx
git commit -m "feat(client): show online roster in DM and player headers"
```

---

## Task 7: Toast store

**Files:**
- Create: `client/src/toasts/store.ts`
- Test: `client/src/toasts/store.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/toasts/store.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useToasts } from './store.js';

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toasts: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('push returns a fresh id and adds the toast', () => {
    const id = useToasts.getState().push('hello', 'info');
    const ts = useToasts.getState().toasts;
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ id, message: 'hello', level: 'info' });
  });

  it('non-sticky toasts auto-expire after 4 seconds', () => {
    useToasts.getState().push('bye', 'error');
    expect(useToasts.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it('sticky toasts do not auto-expire', () => {
    useToasts.getState().push('stay', 'info', { sticky: true });
    vi.advanceTimersByTime(60_000);
    expect(useToasts.getState().toasts).toHaveLength(1);
  });

  it('push with a provided id replaces any existing toast with that id', () => {
    useToasts.getState().push('first', 'info', { id: 'fixed' });
    useToasts.getState().push('second', 'info', { id: 'fixed' });
    const ts = useToasts.getState().toasts;
    expect(ts).toHaveLength(1);
    expect(ts[0].message).toBe('second');
  });

  it('dismiss removes the toast by id', () => {
    const id = useToasts.getState().push('hi', 'info', { sticky: true });
    useToasts.getState().dismiss(id);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run client/src/toasts/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

```ts
// client/src/toasts/store.ts
import { create } from 'zustand';

export type ToastLevel = 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  level: ToastLevel;
  sticky?: boolean;
}

interface PushOpts {
  sticky?: boolean;
  id?: string;
}

interface ToastsState {
  toasts: Toast[];
  push: (message: string, level?: ToastLevel, opts?: PushOpts) => string;
  dismiss: (id: string) => void;
}

const AUTO_EXPIRE_MS = 4000;

let _counter = 0;
function nextId(): string {
  _counter += 1;
  return `t-${_counter}`;
}

export const useToasts = create<ToastsState>((set, get) => ({
  toasts: [],
  push: (message, level = 'info', opts = {}) => {
    const id = opts.id ?? nextId();
    set((s) => ({
      toasts: [
        ...s.toasts.filter((t) => t.id !== id),
        { id, message, level, sticky: opts.sticky },
      ],
    }));
    if (!opts.sticky) {
      setTimeout(() => {
        const exists = get().toasts.find((t) => t.id === id);
        if (exists && !exists.sticky) get().dismiss(id);
      }, AUTO_EXPIRE_MS);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run client/src/toasts/store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/toasts/store.ts client/src/toasts/store.test.ts
git commit -m "feat(client): toast store with auto-expire and sticky support"
```

---

## Task 8: Toast host component

**Files:**
- Create: `client/src/toasts/ToastHost.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// client/src/toasts/ToastHost.tsx
import { useToasts, type Toast } from './store.js';

function bgFor(level: Toast['level']): string {
  return level === 'error' ? '#fdecea' : '#eef4ff';
}
function borderFor(level: Toast['level']): string {
  return level === 'error' ? '#e74c3c' : '#3498db';
}

export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 360,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.level === 'error' ? 'alert' : 'status'}
          onClick={() => dismiss(t.id)}
          style={{
            background: bgFor(t.level),
            border: `1px solid ${borderFor(t.level)}`,
            borderRadius: 6,
            padding: '8px 12px',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 14,
            color: '#222',
            cursor: 'pointer',
            pointerEvents: 'auto',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.client.json --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add client/src/toasts/ToastHost.tsx
git commit -m "feat(client): ToastHost top-right container"
```

---

## Task 9: Wire server `error` events to toasts in both apps

**Files:**
- Modify: `client/src/DmApp.tsx`
- Modify: `client/src/PlayerApp.tsx`

- [ ] **Step 1: Mount ToastHost and wire the error listener in DmApp**

In `client/src/DmApp.tsx`:

- Import:

```ts
import { ToastHost } from './toasts/ToastHost.js';
import { useToasts } from './toasts/store.js';
```

- Inside the existing `useEffect`, alongside the other `socket.on(...)` wiring, add:

```ts
const onSocketError = (p: { code: string; message: string }) => {
  useToasts.getState().push(p.message ?? 'Error', 'error');
};
socket.on('error', onSocketError);
```

And register cleanup in the `return () => { ... }` block: `socket.off('error', onSocketError);`.

- In the rendered JSX, add `<ToastHost />` as a sibling of the top-level `<div>` (or wrap the existing tree in a `<>...</>` fragment and append it):

```tsx
return (
  <>
    <div style={{ /* existing grid */ }}>
      {/* existing content */}
    </div>
    <ToastHost />
  </>
);
```

Apply the same change to the error / bootstrapping early-return branches (so toasts render even before connection):

```tsx
if (phase === 'error') {
  return (
    <>
      <main style={{ ... }}>{/* existing error UI */}</main>
      <ToastHost />
    </>
  );
}
```

- [ ] **Step 2: Same wiring in PlayerApp**

In `client/src/PlayerApp.tsx`:

- Same imports.
- Inside the existing `useEffect`, after `socket.on('disconnect', onDisconnect);`:

```ts
const onSocketError = (p: { code: string; message: string }) => {
  useToasts.getState().push(p.message ?? 'Error', 'error');
};
socket.on('error', onSocketError);
```

And cleanup `socket.off('error', onSocketError)`.

- Wrap returns with `<>...</>` and add `<ToastHost />` at the end of each returned tree.

- [ ] **Step 3: Type-check**

Run: `npx tsc -p tsconfig.client.json --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add client/src/DmApp.tsx client/src/PlayerApp.tsx
git commit -m "feat(client): surface server error events as toasts"
```

---

## Task 10: Disconnect grace-period toast

**Files:**
- Modify: `client/src/DmApp.tsx`
- Modify: `client/src/PlayerApp.tsx`

- [ ] **Step 1: Augment the disconnect handler in DmApp**

In `client/src/DmApp.tsx`, just before the existing `socket.on('connect', onConnect)` line, introduce a reconnect timer + sticky-toast id local to the effect:

```ts
const RECONNECT_TOAST_ID = 'socket-reconnecting';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const onConnect = () => {
  setPhase('connected');
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  useToasts.getState().dismiss(RECONNECT_TOAST_ID);
};

const onDisconnect = () => {
  setPhase('connecting');
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    useToasts.getState().push('Reconnecting…', 'info', {
      sticky: true,
      id: RECONNECT_TOAST_ID,
    });
  }, 3000);
};
```

Replace the existing `onConnect = () => setPhase('connected')` and `onDisconnect = () => setPhase('connecting')` lines with the versions above. Cleanup (existing `socket.off` block) is fine as-is; also clear the timer:

```ts
return () => {
  cancelled = true;
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  socket.off('connect', onConnect);
  socket.off('disconnect', onDisconnect);
  socket.off('error', onSocketError);
  detach();
};
```

- [ ] **Step 2: Same change in PlayerApp**

Apply the identical pattern to `client/src/PlayerApp.tsx`. The existing `onConnect`/`onDisconnect` definitions are replaced; cleanup gains the timer-clear and `socket.off('error', ...)`.

- [ ] **Step 3: Type-check**

Run: `npx tsc -p tsconfig.client.json --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add client/src/DmApp.tsx client/src/PlayerApp.tsx
git commit -m "feat(client): sticky 'Reconnecting…' toast after 3s disconnect grace"
```

---

## Task 11: Playwright reconnect-and-presence e2e

**Files:**
- Create: `e2e/reconnect-and-presence.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/reconnect-and-presence.spec.ts
import { test, expect, setupDmCampaign, joinAsPlayer } from './fixtures.js';

test('player drops out of DM header on disconnect and reappears on reconnect', async ({ browser }) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();

  await setupDmCampaign(dmContext);
  await joinAsPlayer(playerContext, 'Robin', '#33aa66');

  const dmPage = await dmContext.newPage();
  const playerPage = await playerContext.newPage();

  await dmPage.goto('/dm');
  await playerPage.goto('/');
  await expect(dmPage.getByText('connected')).toBeVisible({ timeout: 10_000 });
  await expect(playerPage.getByText('connected')).toBeVisible({ timeout: 10_000 });

  // DM header should list the player as online.
  await expect(dmPage.locator('header').getByText('Robin')).toBeVisible({ timeout: 5_000 });

  // Force the player socket to disconnect (without closing the tab).
  await playerPage.waitForFunction(
    () => Boolean((window as unknown as { __vttSocket?: unknown }).__vttSocket),
    null, { timeout: 5_000 },
  );
  await playerPage.evaluate(() => {
    (window as unknown as {
      __vttSocket: { disconnect: () => void };
    }).__vttSocket.disconnect();
  });

  // Player name disappears from the DM header.
  await expect(dmPage.locator('header').getByText('Robin')).toBeHidden({ timeout: 5_000 });

  // Reconnect the player socket.
  await playerPage.evaluate(() => {
    (window as unknown as {
      __vttSocket: { connect: () => void };
    }).__vttSocket.connect();
  });

  // Player reappears, and the active page is still rendered (i.e., full_sync rebuilt state).
  await expect(dmPage.locator('header').getByText('Robin')).toBeVisible({ timeout: 5_000 });
  await expect(playerPage.getByText('connected')).toBeVisible({ timeout: 10_000 });
});
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test e2e/reconnect-and-presence.spec.ts`
Expected: PASS.

If the DM header locator fails because the player name renders in a context Playwright's `getByText` doesn't catch (e.g., split across spans), inspect with `--ui` and tighten the selector.

- [ ] **Step 3: Run the full e2e suite to check for regressions**

Run: `npx playwright test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add e2e/reconnect-and-presence.spec.ts
git commit -m "test(e2e): reconnect and presence round-trip"
```

---

## Task 12: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npm test && npx playwright test`
Expected: every test passes.

- [ ] **Step 2: Run typechecks**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Manual smoke (optional, skip if not running interactively)**

- Open `/dm` and a player session in private windows.
- Confirm DM header lists the player; player header lists no other players (alone).
- Open a second player session with a different name; both player views show the other; DM shows both.
- Have a player attempt to drag a token they don't own (drag a DM-owned token if there is one) — a red toast `cannot move this token` should appear in their browser.
- Stop the server. After 3 seconds, both browsers show `Reconnecting…`. Restart the server — toast vanishes; views recover.

- [ ] **Step 4: Final commit (only if anything was tweaked)**

```bash
git add -A
git status
# Only commit if the working tree shows fixes; otherwise skip.
```

---

## Out-of-band notes

- **No DB migration.** Presence is in-memory only; a server restart resets presence and is announced naturally by clients reconnecting + emitting `player:joined` again.
- **Error codes.** This plan uses the existing codes (`forbidden`, `bad_payload`, `not_found`). If you'd like to align with the spec's preferred names later, that's a separate rename PR.
- **Owner-color ring.** Already implemented in `client/src/canvas/TokenNode.tsx:60-64`. Spec called for a new `OwnerRing.tsx`; that's unnecessary duplication and is omitted from this plan.
- **No HTTP error toasts.** Per the brainstorming decision, REST failures continue to surface inline (existing `MapsLibrary`, `NamePicker`, etc., error states are unchanged).
