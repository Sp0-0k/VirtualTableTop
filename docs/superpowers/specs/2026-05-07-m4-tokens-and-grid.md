# M4 — Grid, Tokens, Movement — Design Spec

**Date:** 2026-05-07
**Status:** Approved for planning
**Owner:** Kirk
**Parent spec:** `docs/superpowers/specs/2026-04-27-vtt-design.md`
**Companion spec (preceding milestone):** `docs/superpowers/specs/2026-05-07-m3-design.md`

## 1. Overview

M4 is the milestone where the canvas comes alive. `react-konva` lands. Both DM and player views become interactive: pan, zoom, drag-place tokens (DM), drag own token (player). Tokens persist with HP / conditions / hidden / HP-visibility metadata, with server-side filtering enforcing that hidden tokens are absent for players and HP-hidden tokens have HP fields stripped. A grid overlay is rendered from `pages.grid_width_squares × grid_height_squares`. Movement uses the parent spec's `token:move_preview` (mid-drag, ephemeral) / `token:move_commit` (drag-end, persisted) pattern; the server broadcasts canonical `token:moved` post-commit and mid-drag `token:moving` relays.

Asset deletion (deferred since M3) is also folded into M4 because the token library makes it operationally important.

**Done when:**

- DM uploads a token image (`kind=token`), drags it from the library onto the canvas, and a token row exists.
- DM and player can both pan (drag empty canvas) and zoom (mouse wheel) the stage.
- DM drags any token; player drags their own; both clients see real-time `token:moving` updates and canonical positions on commit.
- A player attempting to move a DM-owned or other-player-owned token is rejected; their optimistic move snaps back via `state:full_sync`.
- A token with `hidden=1` is invisible to player clients (no `token:created` ever sent; if toggled mid-life, players receive a synthetic `token:deleted`).
- A token with `hp_visible_to_players=0` is delivered to players without `current_hp` / `max_hp`.
- Selected-token popover edits name / owner / size / hidden / HP / conditions / HP-visibility; persists via PATCH; broadcast updates other clients.
- DM can delete unreferenced assets from the library; a 409 with reference list blocks deletion when an asset is in use.

**No schema migration needed.** All token columns exist in `migrations/001_initial.sql`. M4 is pure server + client code.

## 2. Architectural decisions carried from M3

These three principles, set in M3, govern M4's shape:

1. **Config-frequency mutations are HTTP REST under `/api/dm/*`.** Token CRUD (create / update / delete) goes over HTTP. Asset upload and asset deletion go over HTTP.
2. **Interaction-frequency mutations are Socket.IO commands.** Token movement is the first true client→server socket command pair: `token:move_preview` and `token:move_commit`.
3. **Filter at the broadcast boundary.** Clients are never trusted to filter their own visibility. Token-related broadcasts use a per-recipient builder (parent spec §6); the M3-era `io.to('dm')` room pattern is no longer sufficient.

`state:full_sync` extends from M3's `{ activePage }` to `{ activePage, tokens, players }` (active page only; non-active pages stay tokenless until M6 introduces DM private preview).

## 3. HTTP endpoints

All `/api/dm/*` endpoints are DM-only via Caddy `basic_auth` and a route-level `vtt_dm` cookie check (defense-in-depth, M2 pattern).

### Tokens (new in M4)

```
GET    /api/dm/tokens?page_id=:id        200 [Token, …] sorted by z_index, id
POST   /api/dm/tokens                    body: { page_id, asset_id, x, y,
                                                 size_squares?, name? }
                                         201 Token
                                         400 invalid body / unknown asset_id /
                                             unknown page_id
PATCH  /api/dm/tokens/:id                body: subset of {
                                           name, owner_player_id, size_squares,
                                           hidden, current_hp, max_hp,
                                           conditions, hp_visible_to_players,
                                           x, y, z_index
                                         }
                                         200 Token; 404 unknown id

                                         Note: x/y are accepted here for
                                         DM-only manual coordinate fixups
                                         (e.g., typing exact coords). The
                                         interactive movement hot path uses
                                         the socket events below, NOT this
                                         PATCH.
DELETE /api/dm/tokens/:id                204; 404 unknown id
```

Players never hit token CRUD endpoints. Their only mutation power is movement, which is socket-only and per-token-ownership scoped.

### Assets — deletion (added to M4)

```
DELETE /api/dm/assets/:id                204 — deleted; broadcast asset:deleted (DM-only)
                                         404 — unknown id
                                         409 — referenced; body {
                                             references: {
                                               pages:  [{ id, name }],
                                               tokens: [{ id, name, page_id }]
                                             }
                                           }
```

No cascading delete. The schema's `tokens.asset_id ON DELETE RESTRICT` is the DB-level safety net; the route checks first to produce a structured 409 instead of a raw SQLite error.

## 4. Socket.IO events (M4 surface)

### Client → server (NEW in M4)

```
token:move_preview   { id, x, y }    throttled ~30–60 Hz; ephemeral; no DB write
token:move_commit    { id, x, y }    drag-end; persists + canonical broadcast
```

Auth on each event:

| Command | DM | Player |
| --- | --- | --- |
| `token:move_preview`, `token:move_commit` | allowed for any token | allowed only when `token.owner_player_id === socket.data.playerId` |

`x`, `y` are floats in **image-pixel space** (parent spec §5). Snap-to-grid is computed client-side at commit time; the server stores whatever the client commits.

Rejection: server emits `error { code: 'forbidden', message }` to the offender; no broadcast. Client clears its `dragging[id]` state and re-emits `state:request_full_sync` to re-sync.

### Server → client (M4 additions, per-recipient filtered)

```
token:created     { token }               // after POST /api/dm/tokens
token:updated     { token }               // after PATCH; filtered per-recipient
token:deleted     { id, page_id }         // after DELETE; also synthesized for
                                          //   players when a token becomes
                                          //   hidden mid-life
token:moving      { id, x, y, by }        // mid-drag relay; never sent to mover
token:moved       { id, x, y }            // canonical post-commit; sent to all
                                          //   including mover (release-dragging
                                          //   signal)
```

### Server → DM only ('dm' room)

```
asset:deleted     { id, kind }            // after successful DELETE /api/dm/assets/:id
```

(`asset:created` already exists from M3.)

### `state:full_sync` extension

```
{
  activePage: Page | null,
  tokens:     Token[],     // active page only, filtered for the recipient
  players:    Player[],    // [{ id, name, color }]
}
```

M3 shipped `{ activePage }`; M4 extends. M5 will further extend with `fog`. Clients tolerate missing keys (treat as empty).

## 5. Filtering at the broadcast boundary

This is the central piece of M4 server complexity. A single helper module (`server/src/broadcast.ts`, extended from M3) defines:

```ts
function tokenForSocket(token: TokenRow, socket: Socket): TokenPayload | null {
  if (socket.data.role === 'dm') return fullToken(token);
  if (token.hidden) return null;                      // omit entirely
  const out = fullToken(token);
  if (!token.hp_visible_to_players) {
    out.current_hp = undefined;
    out.max_hp = undefined;
  }
  return out;
}

function broadcastTokenEvent(
  event: 'token:created' | 'token:updated' | 'token:moved'
       | 'token:moving'  | 'token:deleted',
  token: TokenRow,
  opts?: { skipSocketId?: string }
) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.id === opts?.skipSocketId) continue;
    const payload = tokenForSocket(token, socket);
    if (payload === null) {
      // Player-side hidden. If this is an UPDATE that just *flipped* hidden
      // from 0 → 1, the player must drop the token from their store.
      if (event === 'token:updated') {
        socket.emit('token:deleted', { id: token.id, page_id: token.page_id });
      }
      continue;
    }
    socket.emit(event, payload);
  }
}
```

Three filter-edge cases this design handles:

1. **`hidden: 0 → 1`**: filter returns `null`; the `token:updated` branch synthesizes a `token:deleted` to player sockets. Their store's `removeToken` action handles it idempotently.
2. **`hidden: 1 → 0`**: filter returns a payload; `token:updated` is emitted. Player stores upsert-on-`token:updated` (idempotent — unknown id is treated as create).
3. **`hp_visible_to_players` toggled**: filter strips/keeps HP fields. Same `token:updated` event flows; clients overwrite their copy.

`token:moving` skips the mover's socket (`opts.skipSocketId`) — the mover is already showing the live drag position from their own input. `token:moved` is broadcast to **all** sockets including the mover; the mover uses it as the "release `dragging[id]`" signal once the canonical write has landed.

## 6. The "moving" pattern, exact mechanics

Three distinct positions a client may render for a token:

| Source | When | Authoritative? |
| --- | --- | --- |
| **Local optimistic** | Mover, mid-drag | No — discarded on commit/server response |
| **Relay** (`token:moving`) | Non-movers, mid-drag | No — last received wins; replaced on `token:moved` |
| **Canonical** (DB → broadcast) | Everyone, post-commit | Yes |

### Mover side (DM or owning player)

1. `pointerdown` on a token → drag starts. Local Zustand `dragging[id] = { x, y }` is set; Konva `Group` reads it.
2. `pointermove` (every event): update `dragging[id]` locally → re-render. **`requestAnimationFrame`-throttle the emit**: at most one `token:move_preview` per frame, at most one in flight (drop the queued one if a newer frame fires). Net rate ≈ 30–60 Hz, payload ~24 bytes JSON.
3. `pointerup`:
   - Compute final position. If `e.evt.altKey` was held, use raw cursor pos. Otherwise snap: `snap(x) = Math.round(x / cellW) * cellW + cellW / 2` (and same for y), where `cellW = mapImg.width / page.grid_width_squares`.
   - Emit `token:move_commit { id, x, y }`.
   - Keep `dragging[id]` set with the final pos until canonical `token:moved` arrives, then clear. Avoids a one-frame flash to the stale store position.

### Server side

- `token:move_preview`: validate ownership (`role === 'dm' || token.owner_player_id === playerId`). On reject → `error` to offender, no broadcast. On accept → `broadcastTokenEvent('token:moving', { ...token, x, y, by: playerIdOrDm }, { skipSocketId: source.id })`. **No DB write.**
- `token:move_commit`: same validation. `UPDATE tokens SET x=?, y=?, updated_at=? WHERE id=?`. Re-fetch the row by primary key. `broadcastTokenEvent('token:moved', updatedToken)` — emitted to all including the mover (mover uses it as a "release dragging" signal).

### Non-mover side

- `token:moving { id, x, y, by }`: write `incomingMove[id] = { x, y }` (separate slot from `dragging`). Konva renders this when present, falling back to canonical token position otherwise.
- `token:moved`: write the canonical row into `tokens[id]`, clear `incomingMove[id]`.

### Why `by` on `token:moving`

Lets future work (M6 selection-ring "who's grabbing what") trigger off this without another protocol change. Pure-additive; ignoring it is free.

## 7. Konva canvas structure

A single `react-konva` `<Stage>` shared by DM and player views. Same component, different props.

```
<Stage width=viewportW height=viewportH
       x=panX y=panY scaleX=zoom scaleY=zoom
       draggable={true}                      // pan when nothing else captures
       onWheel={zoomAtCursor}>
  <Layer listening={false}>                  {/* background */}
    <Image image={mapImg} />
  </Layer>

  <Layer listening={false}>                  {/* grid */}
    <GridLines page={activePage} />
  </Layer>

  <Layer>                                    {/* tokens — interactive */}
    {tokens.map(t => <TokenNode token={t} … />)}
  </Layer>

  <Layer listening={false}>                  {/* selection chrome (DM only) */}
    {selectedTokenId != null && <SelectionRing token={selected} />}
  </Layer>
</Stage>
```

**Coordinate space.** Stage content is in image-pixel coordinates 1:1 with token `(x, y)`. Pan/zoom happen at the Stage level (`x/y/scaleX/scaleY`). World↔screen conversions are isolated to one helper (`stageToWorld(stage, evtPoint)`).

**Grid math.** `cellW = mapImg.width / page.grid_width_squares`, `cellH = mapImg.height / page.grid_height_squares`. `<GridLines>` memoized; re-renders only on page or image change.

**TokenNode.** A draggable `<Group>` at `(token.x, token.y)`:

- `<Image>` sized `cellW * size_squares × cellH * size_squares`, centered on position.
- `<Circle>` ring (always-on owner-color: player color when matching a known player, neutral grey for DM-owned, dashed grey for unowned).
- `<Text>` name label below the image.

Drag handlers wired via `draggable` prop, gated on `movableTokenIds.has(token.id)`.

**Pan & zoom.** Stage `draggable=true`; pan engages when no token captures the pointer. Wheel:

```ts
const scaleBy = 1.1;
const oldScale = stage.scaleX();
const pointer = stage.getPointerPosition();
const mousePointTo = {
  x: (pointer.x - stage.x()) / oldScale,
  y: (pointer.y - stage.y()) / oldScale,
};
const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
const clamped = Math.max(0.1, Math.min(8, newScale));
stage.scale({ x: clamped, y: clamped });
stage.position({
  x: pointer.x - mousePointTo.x * clamped,
  y: pointer.y - mousePointTo.y * clamped,
});
```

**Drop-from-library (DM only).** HTML5 drag-and-drop from sidebar thumbnails to the Stage container `<div>`. On drop:

1. Read `dataTransfer` for `assetId`.
2. `stageToWorld(stage, { x: e.clientX - rect.left, y: e.clientY - rect.top })` → world coords.
3. `POST /api/dm/tokens { page_id, asset_id, x, y, size_squares: 1 }`.

Server emits `token:created`; the response also lands in the DM's store (idempotent upsert).

## 8. Token payload shape (broadcast version)

```ts
{
  id: number,
  page_id: number,
  asset_id: number,
  asset_url: string,                  // server-resolved '/assets/<hash>.webp'
  asset_thumb_url: string,            // '/assets/<hash>.thumb.webp'
  name: string | null,
  x: number,
  y: number,
  size_squares: number,
  owner_player_id: number | null,
  hidden: 0 | 1,                      // DM-only meta; absent in player payload
  current_hp: number | null | undefined,    // undefined = filtered out
  max_hp: number | null | undefined,
  conditions: string[],               // parsed from conditions_json
  hp_visible_to_players: 0 | 1,       // DM-only meta; absent in player payload
  z_index: number,
}
```

Player payloads simply omit (don't send) `hidden` and `hp_visible_to_players` since hidden tokens never reach players at all and `hp_visible_to_players` is a DM-side toggle.

## 9. Server module layout (additions)

```
server/src/
├── db/
│   └── tokens.ts          insert, listByPage, get, update (partial),
│                          updateXY (hot-path tight statement), delete,
│                          findReferencesByAsset (used by asset DELETE)
├── routes/
│   ├── dm-tokens.ts       POST/GET/PATCH/DELETE under /api/dm/tokens
│   └── dm-assets.ts       (existing) — add DELETE handler with reference
│                          check + atomic unlink + asset:deleted broadcast
├── socket/
│   ├── auth.ts            (existing)
│   ├── token-move.ts      handleMovePreview, handleMoveCommit (NEW)
│   └── index.ts           wires the two new handlers
├── broadcast.ts           (existing) — add tokenForSocket,
│                          broadcastTokenEvent; extend buildFullSync
│                          to include filtered tokens + players list
└── server.ts              (existing) — mount /api/dm/tokens routes
```

`pipeline.ts` already supports `kind=token` (max 512×512, 128×128 thumb per parent spec §8). The token branch is exercised for the first time in M4.

## 10. Client structure

### Shared canvas

`client/src/canvas/Canvas.tsx` — used by both DM and player. Props:

```ts
{
  page: Page,                       // page being rendered
  tokens: Token[],                  // already filtered server-side
  movableTokenIds: Set<number>,     // ids draggable by the local user
  selectable: boolean,              // DM=true, player=false
  onSelect?: (id: number | null) => void,
  onDropAsset?: (assetId: number, world: { x: number; y: number }) => void,
}
```

Internals: the four-layer Stage from §7, pan/zoom via stage drag + wheel, drop handler on the container div, token drag handlers wired to `socket.emit('token:move_preview' | 'token:move_commit')`. Reads `dragging` and `incomingMove` from the store; writes `selectedTokenId` via `onSelect`.

### Zustand stores

DM (extends M3):

```ts
{
  ...m3State,                       // pages, selectedPageId, activePageId, assets
  tokens: Record<number, Token>,    // active page only
  players: Player[],
  selectedTokenId: number | null,
  dragging: Record<number, { x: number; y: number }>,
  incomingMove: Record<number, { x: number; y: number }>,
  // actions: upsertToken, removeToken, setDragging, clearDragging,
  //          setIncomingMove, clearIncomingMove,
}
```

Player (extends M3):

```ts
{
  activePage: Page | null,
  tokens: Record<number, Token>,
  players: Player[],
  myPlayerId: number,
  dragging, incomingMove,           // same shape; only own token populates dragging
}
```

`movableTokenIds` is a derived selector: DM = all token ids; player = `tokens.filter(t => t.owner_player_id === myPlayerId).map(t => t.id)`.

### DM-only UI additions

1. **Token library panel** under Maps in the sidebar: grid of token thumbnails, `+ Upload` affordance hitting `POST /api/dm/assets/upload` with `kind=token`. Each thumbnail is HTML5-draggable: `dataTransfer.setData('application/x-vtt-asset', String(asset.id))`. Each thumbnail has a small `×` delete button.

2. **`×` on library thumbnails** (maps and tokens). Click → confirm dialog. On 409 → toast lists references (`"Used by 2 pages: 'Caves', 'Tavern'"`). On 204 → store removes the asset; the broadcast also confirms it for the same DM's other tabs.

3. **Selected-token popover** (`<TokenPopover>`): floats next to the selected token's screen position. Fields:
   - **Name** — text input, blur-commits PATCH.
   - **Owner** — select: DM / each player / unowned.
   - **Size** — number input 1–4.
   - **Hidden** — checkbox.
   - **HP** — current / max number inputs (null allowed = "doesn't track HP").
   - **HP visible to players** — checkbox.
   - **Conditions** — chips with picker. M4 ships a fixed D&D 5e list: blinded, charmed, deafened, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious, exhaustion. No custom strings in M4.
   - **Delete** — button with confirm.

   Each field commits on blur or change via `PATCH /api/dm/tokens/:id`. **No optimistic update** — the round-trip is fast and PATCH responses arrive as `token:updated` broadcasts which the store applies. Saves a class of bugs.

4. **Page Settings tab in the top toolbar:** `grid_width_squares` / `grid_height_squares` editor for the selected page (PATCH `/api/dm/pages/:id`). Already partially in place from M3; M4 surfaces the controls because the grid is now visible.

### Player UI additions

- Canvas replaces the M3 `<img>`. Top bar gains an online-players list (`"Hi, Alice — Bob, Carol online"`).
- Player can pan/zoom freely and drag their own token.
- The owner-color ring on every token already identifies which one is theirs; no explicit selection state, no popover, no editing.

## 11. Asset deletion — order of operations

Server route handler for `DELETE /api/dm/assets/:id`:

1. SELECT asset by id → 404 if absent.
2. SELECT `id, name FROM pages WHERE background_asset_id = ?`.
3. SELECT `id, name, page_id FROM tokens WHERE asset_id = ?`.
4. If either is non-empty → 409 with the lists.
5. `fs.unlink(uploads/<hash>.webp)` and `<hash>.thumb.webp` — `ENOENT`-tolerant (treat missing file as success; the DB row is the source of truth).
6. `DELETE FROM assets WHERE id = ?` inside `BEGIN IMMEDIATE` together with steps 2–3 to avoid TOCTOU between the reference check and delete.
7. `io.to('dm').emit('asset:deleted', { id, kind })`.

**TOCTOU note.** Concurrent token-create against this asset between steps 2–3 and step 6 is contained: `BEGIN IMMEDIATE` serializes writes against this connection, and `tokens.asset_id ON DELETE RESTRICT` causes the DELETE to fail the FK check, rolling the transaction back. The route then returns 409 with the now-existent token reference. Cleanest available recovery for a hobby-scale app.

## 12. Testing strategy

Three layers, no Playwright in M4 (deferred to M6 once a full session flow exists). Roughly +25–30 tests on top of M3.

### Unit (vitest, in-memory SQLite, tmpdir)

- `db/tokens.ts`: insert / list-by-page / get / update / delete round-trips.
- `db/tokens.ts`: `updateXY` is a tight single-statement path (the move-commit hot path).
- `db/tokens.ts`: `findReferencesByAsset` returns empty arrays when no references exist; correctly partitions `pages.background_asset_id` and `tokens.asset_id` references.
- `broadcast.ts` `tokenForSocket`:
  - DM socket gets full record.
  - Player socket gets `null` for `hidden=1` token.
  - Player socket gets HP fields stripped when `hp_visible_to_players=0`.
  - Player socket gets full HP fields when `hp_visible_to_players=1`.
- `pipeline.ts` token branch: 1024×1024 PNG → 512-cap WebP, 128×128 thumb generated.
- Snap helper: world point + cellW → snapped center; Alt-bypass returns input unchanged.

### Konva scene-graph assertions (vitest + `konva/lib/index-node`, no DOM)

- Render `Canvas` with one token at world `(100, 200)`, `size_squares=1`, `cellW=50`. `stage.findOne('#token-id').x() === 100`, `.y() === 200`. `findOne('Image').width() === 50`.
- Render with `size_squares=2`. Image width/height = `2 * cellW`.
- Render with one token selected. `stage.findOne('SelectionRing')` exists; `.attrs.tokenId === selectedId`.
- Render with player A's token (color=`#ff8800`). The owner `<Circle>` ring `stroke === '#ff8800'`. DM-owned → neutral grey. Unowned → dashed grey.
- Render with `grid_width_squares=20`, `grid_height_squares=15`. Count of `Line` nodes in the grid layer matches the implementation's formula (the test pins it so subtle off-by-ones surface).

### Integration (supertest)

- `POST /api/dm/tokens` happy path → 201, row inserted.
- `POST /api/dm/tokens` with unknown `asset_id` → 400.
- `POST /api/dm/tokens` with unknown `page_id` → 400.
- `PATCH /api/dm/tokens/:id` updates a subset of fields; row reflects.
- `DELETE /api/dm/tokens/:id` → 204.
- All `/api/dm/tokens/*` without DM cookie → 401.
- `GET /api/dm/tokens?page_id=:id` lists only that page's tokens.

Asset deletion:

- `DELETE /api/dm/assets/:id` happy path → 204, file unlinked, row gone.
- `DELETE` with page reference → 409, body lists the page; row preserved; file preserved.
- `DELETE` with token reference → 409, body lists the token; row preserved.
- `DELETE` with both reference types → 409, both lists populated.
- `DELETE` unknown id → 404.
- `DELETE` without DM cookie → 401.
- After successful `DELETE` → DM socket receives `asset:deleted`.

### Socket integration (extends the M3 harness)

- DM connects after a page is active with 3 tokens (one hidden, one HP-hidden, one normal) → `state:full_sync` carries 3 tokens with full fields.
- Player connects same scenario → `state:full_sync` carries 2 tokens (hidden absent); HP-hidden has no HP fields.
- DM creates a token via HTTP → DM socket receives `token:created`; player socket receives a filtered version.
- DM creates a hidden token → player socket receives no event.
- DM patches a token from `hidden=0` → `hidden=1` → player socket receives synthetic `token:deleted`. DM socket receives `token:updated`.
- DM patches `hidden=1` → `hidden=0` → player socket receives `token:updated` (idempotent upsert).
- DM patches `hp_visible_to_players=1 → 0` → player socket receives `token:updated` with HP undefined.
- Player A emits `token:move_commit` for their own token → DB updated; DM and Player B both receive `token:moved`; Player A also receives canonical `token:moved`.
- Player A emits `token:move_commit` for Player B's token → server emits `error`; no DB write; no broadcast.
- Player A emits `token:move_preview` for unowned token → server emits `error`; no `token:moving` broadcast.
- Sequence: `move_preview` × 5 → `move_commit` → DB shows the commit position (not preview).

### Manual smoke (final task of the implementation plan, M3 pattern)

Two browsers (DM + player Alice).
1. DM uploads a token, drops it on the canvas, sets owner=Alice.
2. Alice drags it; DM sees it move smoothly.
3. DM toggles hidden; Alice's view loses the token.
4. DM unhides; it returns.
5. DM patches HP-hidden; Alice sees no HP fields.
6. DM tries to delete the token's asset → 409 toast lists the referenced token.
7. DM deletes the token, then deletes the asset → succeeds.

### Explicitly skipped in M4

- Playwright (deferred to M6 — full-flow tests once fog also exists).
- Visual / pixel-diff regression on Konva (replaced by scene-graph assertions above).
- Performance / load (5 clients × tokens at 30 Hz is trivially within budget).

## 13. Deferred / explicitly out of scope for M4

- **Token z-index UI** — `z_index` exists in schema, server returns it, client respects it on render, but no UI to reorder. M6 if needed.
- **Multi-select / box-drag** — single-token selection only.
- **Custom condition strings** — fixed D&D 5e list only.
- **DM private preview of non-active pages with their tokens** — M6 (parent spec `page:dm_navigate`).
- **Reconnect resync correctness review** — Socket.IO auto-reconnect works; the explicit `state:request_full_sync` path exists for error-recovery. Full review = M6.
- **HP-bar overlay on token canvas** — popover only in M4 (per "owner-color ring always" choice).
- **Initiative tracker, vision/light, walls** — all v2 (M7+).
- **Rate limiting on `token:move_*`** — not needed at one-DM-and-friends scale. Add a token bucket on the socket if abuse appears.
- **Page change while a player is mid-drag** — vanishingly rare; recoverable via `state:full_sync`. Not specifically handled.

## 14. Spec deviations recorded

The parent spec `2026-04-27-vtt-design.md` does not need patching for M4 — the M4 scope and event names are already captured there. M3's spec already noted the HTTP-vs-socket split that M4 inherits.

One small refinement worth noting back to the parent spec if a future revision happens: the synthetic `token:deleted` emitted to player sockets when a token's `hidden` flag flips `0 → 1` is an implementation detail not explicitly described in §6, but it falls naturally out of "filter at the broadcast boundary" and avoids player-side stale state. No spec change required.

## 15. Deployment notes

No new env vars. No new services. No Caddy changes — token assets live under the same `/assets/<hash>.webp` URLs as map assets. No new migrations. The pm2-managed Node process and the existing build pipeline continue to apply.

`react-konva` and `konva` are added to the client `dependencies`; `konva` is a moderate-size dep (~250 KB minified). Server-side, no new packages — the existing `sharp` / `multer` / `file-type` already cover the token branch of the upload pipeline.
