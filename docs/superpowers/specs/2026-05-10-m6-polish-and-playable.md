# M6 — Polish & Playable Design Spec

**Date:** 2026-05-10
**Status:** Approved for planning
**Parent spec:** `docs/superpowers/specs/2026-04-27-vtt-design.md` §12
**Owner:** Kirk

## 1. Goal

Close the remaining UX gaps before running a real session. Add real-time presence, owner-color rings on tokens, error toasts, and verify reconnection works end-to-end. Defer `page:dm_navigate` from the parent spec — DM page navigation remains client-local; no server round-trip in v1.

**Done when:** a real session can run end-to-end without major UX papercuts: players see who else is online, players can tell whose token is whose at a glance, permission denials surface visibly, and a dropped connection recovers cleanly.

## 2. Scope

### In scope

- Real-time presence (`player:joined`, `player:left`, `online_player_ids` in `state:full_sync`).
- Owner-color permanent ring on every player-owned token, visible to all clients.
- Toast system surfacing server `error` events and a grace-period socket-disconnect indicator.
- Standardized `error` emission from existing socket handlers (`token:move_*`, `fog:stroke_*`).
- Playwright spec verifying reconnect restores state correctly.

### Out of scope

- `page:dm_navigate` event. Cut from M6; revisit if multi-DM-tab sync becomes painful.
- HTTP-layer error toasts. REST failures continue to surface inline at the call site (`MapsLibrary`, `NewPageModal`, etc.).
- Success toasts.
- Persistent connection-status pill in headers (the disconnect toast covers the user-visible case).
- Player color picker — already shipped in M2.
- Explicit `state:request_full_sync` client→server event. The server already re-sends `state:full_sync` on every connection, including auto-reconnects.

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Server                                                      │
│                                                             │
│  presence.ts (in-memory)                                    │
│    Map<playerId, Set<socketId>>                             │
│       │                                                     │
│       ├─ onConnect → first-socket?  → io.emit player:joined │
│       └─ onDisconnect → last-socket? → io.emit player:left  │
│                                                             │
│  broadcast.ts                                               │
│    buildFullSync includes online_player_ids                 │
│                                                             │
│  socket/token-move.ts, socket/fog.ts                        │
│    standardize: reject path → socket.emit('error', …)       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ (Socket.IO)
┌─────────────────────────────────────────────────────────────┐
│ Client                                                      │
│                                                             │
│  stores/{dm,player}Store.ts                                 │
│    onlinePlayerIds: Set<number>                             │
│                                                             │
│  socketListeners.ts                                         │
│    +player:joined, +player:left                             │
│                                                             │
│  canvas/TokenNode.tsx → renders <OwnerRing />               │
│  canvas/OwnerRing.tsx (new)                                 │
│                                                             │
│  toasts/store.ts, toasts/ToastHost.tsx (new)                │
│    socket.on('error', …) → push toast                       │
│    disconnect grace timer → sticky "Reconnecting…" toast    │
└─────────────────────────────────────────────────────────────┘
```

**Trust model unchanged.** Server is authoritative. Presence is in-memory only and reconstructed naturally as sockets connect — no DB schema changes, no migration.

**No schema changes.** M6 is purely behavioral; the `players` table already carries `color`, and presence is ephemeral.

## 4. Server changes

### 4.1 `server/src/presence.ts` (new)

Pure module. No I/O. Exports:

```ts
export interface Presence {
  connect(playerId: number, socketId: string): { firstSocket: boolean };
  disconnect(playerId: number, socketId: string): { lastSocket: boolean };
  onlinePlayerIds(): number[];
  isOnline(playerId: number): boolean;
}

export function createPresence(): Presence;
```

Internal: `Map<number, Set<string>>`. `connect` is `firstSocket: true` iff the set did not previously exist (or was empty after stale-cleanup). `disconnect` removes the socketId; `lastSocket: true` iff the set becomes empty (then the entry is removed). Missing-key disconnect is a no-op (`lastSocket: false`).

One instance is created in `attachSocketIO` and held in module scope of `socket.ts`.

### 4.2 `server/src/socket.ts`

On `connection`:
- If `socket.data.role === 'player'`:
  - `const { firstSocket } = presence.connect(playerId, socket.id);`
  - If `firstSocket`: `io.emit('player:joined', { playerId });`
- DM connections do not call presence.

On `disconnect`:
- If `socket.data.role === 'player'`:
  - `const { lastSocket } = presence.disconnect(playerId, socket.id);`
  - If `lastSocket`: `io.emit('player:left', { playerId });`

### 4.3 `server/src/broadcast.ts`

Extend `FullSyncPayload`:

```ts
export interface FullSyncPayload {
  activePage: PagePayload | null;
  tokens: TokenPayload[];
  players: { id: number; name: string; color: string }[];
  online_player_ids: number[];           // NEW
}
```

`buildFullSync` accepts (or closes over) a `Presence` instance and populates `online_player_ids` from `presence.onlinePlayerIds()`. The simplest wiring is to pass `presence` into `buildFullSync(db, socket, presence)`; `attachSocketIO` captures it in the connection handler.

### 4.4 Error event standardization

Audit existing handlers in `server/src/socket/token-move.ts` and `server/src/socket/fog.ts`. Anywhere a command is silently dropped (bad payload, missing token, permission denied), instead emit:

```ts
socket.emit('error', { code, message });
```

Codes used:
- `'permission_denied'` — role/ownership check failed.
- `'invalid_payload'` — payload validation failed.
- `'not_found'` — referenced token/page does not exist.

Targeted only at the offending socket; never broadcast.

## 5. Client changes

### 5.1 Owner-color ring (`client/src/canvas/OwnerRing.tsx`, new)

A Konva `Circle` rendered *behind* the token sprite. Props:

```ts
interface Props {
  token: Token;
  player: Player;       // owner; component is only rendered when owner exists
  cellW: number;
  cellH: number;
}
```

Visuals: thin solid stroke in `player.color`, radius slightly larger than the token bounding circle. Distinct from the existing `SelectionRing` (yellow, dashed, larger). The two can coexist on a selected token; ordering: owner ring → token sprite → selection ring.

### 5.2 `canvas/TokenNode.tsx`

Accept `playersById?: Record<number, Player>` prop. When `token.owner_player_id !== null` and `playersById[ownerId]` exists, render `<OwnerRing>` before the token image. DM-owned tokens (null owner) render no owner ring.

### 5.3 `canvas/Canvas.tsx`

Build `playersById` once from the `players` prop (already passed) and forward to `TokenNode`.

### 5.4 Toast system (`client/src/toasts/`, new)

Two files.

**`store.ts`** — Zustand store:

```ts
interface Toast {
  id: string;
  message: string;
  level: 'error' | 'info';
  sticky?: boolean;       // if true, ignored by auto-expire
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, level?: Toast['level'], opts?: { sticky?: boolean; id?: string }) => string;
  dismiss: (id: string) => void;
}
```

Non-sticky toasts auto-expire after 4 s via a `setTimeout` set inside `push`.

**`ToastHost.tsx`** — fixed top-right container, renders the array. Each toast is a small card; `error` is red-tinted, `info` neutral. Click-to-dismiss; sticky toasts have no auto-dismiss but still respect manual dismiss.

### 5.5 Disconnect handling

In both `DmApp` and `PlayerApp`, augment the existing `onDisconnect` handler:

```ts
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const RECONNECT_TOAST_ID = 'socket-reconnecting';

socket.on('disconnect', () => {
  setPhase('connecting');
  reconnectTimer = setTimeout(() => {
    useToasts.getState().push('Reconnecting…', 'info', {
      sticky: true,
      id: RECONNECT_TOAST_ID,
    });
  }, 3000);
});

socket.on('connect', () => {
  setPhase('connected');
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  useToasts.getState().dismiss(RECONNECT_TOAST_ID);
});
```

Wire `socket.on('error', ({ code, message }) => useToasts.getState().push(message, 'error'))` on mount in both apps.

### 5.6 Presence in stores

Both `dmStore.ts` and `playerStore.ts` get:

```ts
onlinePlayerIds: Set<number>;
setOnlinePlayerIds: (ids: number[]) => void;
markPlayerOnline: (id: number) => void;
markPlayerOffline: (id: number) => void;
```

### 5.7 Socket listener wiring

`socketListeners.ts` — both `attachDmListeners` and `attachPlayerListeners` add:

```ts
onPlayerJoined: (p: { playerId: number }) => void;
onPlayerLeft:   (p: { playerId: number }) => void;
```

App-level handlers call `markPlayerOnline` / `markPlayerOffline`.
`onFullSync` calls `setOnlinePlayerIds(p.online_player_ids)`.

### 5.8 Header rendering

**`PlayerApp.tsx`** — the existing "you are alone / other names" line filters `players` by `onlinePlayerIds` before extracting names. Offline players never appear.

**`DmApp.tsx`** — header gains a right-side label listing online player names (currently the right side of the header is empty). Same filter logic.

### 5.9 `api.ts`

Add `online_player_ids: number[]` to the `FullSyncPayload` type so the store handlers type-check.

## 6. Event taxonomy (delta from parent spec §6)

```
S→C   player:joined          { playerId: number }            broadcast to all
S→C   player:left            { playerId: number }            broadcast to all
S→C   error                  { code: string; message: string } sent to offending socket only
S→C   state:full_sync        extended: +online_player_ids: number[]
```

No new client→server events.

## 7. Reconnection

Already functional via Socket.IO's built-in auto-reconnect. The server's connection handler emits `state:full_sync` on every connection; client `onFullSync` handlers wipe local state and rebuild. M6 adds verification rather than new code on the reconnect path.

The disconnect-grace toast (§5.5) is the only user-visible reconnection addition.

## 8. Testing

### 8.1 Unit (vitest)

`server/src/presence.test.ts`:
- Connect player A from one socket → `firstSocket: true`. `onlinePlayerIds` includes A.
- Connect player A from a second socket → `firstSocket: false`.
- Disconnect one of A's two sockets → `lastSocket: false`.
- Disconnect A's remaining socket → `lastSocket: true`. `onlinePlayerIds` no longer includes A.
- Disconnect for an unknown player → `lastSocket: false`, no throw.

### 8.2 Integration (vitest + socket.io-client)

`server/src/socket-presence.test.ts`:
- Two player sockets for the same player connect → `player:joined` fires exactly once; full_sync to the second socket already shows the player as online.
- Two different players connect → two `player:joined` events; both visible in each other's full_sync `online_player_ids`.
- Player closes one of two tabs → no `player:left` fires. Closes second tab → `player:left` fires once.
- DM connect/disconnect emits neither event.
- A player emits an invalid `token:move_commit` (no such token id) → the offending socket receives an `error` event with `code: 'not_found'`; other sockets receive nothing.
- A player attempts to move a token they do not own → `error` with `code: 'permission_denied'`.

### 8.3 E2E (Playwright)

`e2e/reconnect-and-presence.spec.ts`:
- Bootstrap: DM + one player, both connected to the same active page with one player-owned token at a known position.
- Assert DM header lists the player as online.
- In the player browser, force a socket disconnect (`socket.disconnect()` via page evaluate).
- Assert (within reconnect-grace) DM header drops the player.
- Reconnect (`socket.connect()`).
- Assert DM header restores the player; player view shows correct token position, active page background, and fog strokes (i.e., full_sync rebuilt state).

### 8.4 Not tested

- Visual styling of the toast or the owner ring.
- Exact pixel position of header roster.
- Multi-player presence scaling (4 players is the realistic ceiling).

## 9. File map

### New

```
server/src/presence.ts
server/src/presence.test.ts
server/src/socket-presence.test.ts
client/src/canvas/OwnerRing.tsx
client/src/toasts/store.ts
client/src/toasts/ToastHost.tsx
e2e/reconnect-and-presence.spec.ts
```

### Modified

```
server/src/socket.ts                  presence wiring + player:joined / player:left emits
server/src/broadcast.ts               +online_player_ids on FullSyncPayload; buildFullSync takes presence
server/src/socket/token-move.ts       standardize error emission on reject paths
server/src/socket/fog.ts              standardize error emission on reject paths
client/src/api.ts                     +online_player_ids on FullSyncPayload type
client/src/socketListeners.ts         +player:joined / player:left handlers (both roles)
client/src/stores/dmStore.ts          +onlinePlayerIds slice
client/src/stores/playerStore.ts      +onlinePlayerIds slice
client/src/DmApp.tsx                  mount ToastHost; wire error + disconnect toasts; online roster in header
client/src/PlayerApp.tsx              mount ToastHost; wire error + disconnect toasts; filter header by online
client/src/canvas/Canvas.tsx          build playersById; forward to TokenNode
client/src/canvas/TokenNode.tsx       accept playersById; render OwnerRing for player-owned tokens
```

## 10. Open items

None. All ambiguities resolved during brainstorming.
