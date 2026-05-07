# Virtual Tabletop — Design Spec

**Date:** 2026-04-27
**Status:** Approved for planning
**Owner:** Kirk

## 1. Overview

A web-based virtual tabletop for running a single ongoing D&D 5e campaign. Hosts the visual/spatial layer of play (maps, tokens, fog of war) for one DM and a small group of players. Voice chat, dice, and rules-system mechanics live elsewhere (Discord, physical dice, etc.).

The application supports **one campaign forever** — there is no concept of multi-tenancy or multiple campaigns. Multiple **pages** (maps) live within that one campaign and can be swapped between as the party moves around the world.

## 2. Scope

### In scope (MVP, v1)

- Map display with a configurable grid overlay
- Draggable tokens with snap-to-grid (and Alt-modifier free movement)
- Distinct DM and Player views over a shared canvas state
- Multiple pages, with DM "prep mode" (private preview of non-active pages) and a "Set Active" action that pushes a page to all players
- Fog of war painted by the DM (vector brush strokes, reveal/hide modes)
- Asset library: separately uploaded maps and tokens, reusable across pages, deduped by content hash
- Server-side image normalization (downscale + WebP re-encode) on upload
- Per-token data: name, position, size, owner, hidden flag, HP, max HP, conditions, HP visibility flag
- Authentication via shared passwords (Basic Auth at nginx) plus name-picker for player identity

### Stretch (v2, post-MVP)

- Dynamic line-of-sight: DM-drawn walls + per-token vision computation, producing a "currently visible" overlay separate from the manual "explored" fog
- Light sources on tokens
- Anything else identified during real-session use

### Explicitly out of scope

- In-app dice roller (Discord/physical dice fill this role)
- Text chat (Discord fills this role)
- Initiative tracker, character sheets, rules automation
- Multi-campaign or multi-DM support
- Backups in v1 (data loss on EC2 termination is acceptable; assets exist on the DM's local machine)
- Real-time CRDT / OT conflict resolution (last-write-wins is sufficient at this scale)

## 3. Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js (LTS) |
| Language | TypeScript everywhere (server + client) |
| HTTP framework | Express |
| Real-time | Socket.IO |
| Database | SQLite via `better-sqlite3` (synchronous API, WAL mode) |
| Image processing | `sharp` |
| Frontend framework | React 18 |
| Frontend canvas | `react-konva` (Konva 2D scene graph) |
| Frontend state | Zustand |
| Frontend bundler | Vite |
| Server bundler | esbuild |
| Reverse proxy | nginx (existing on EC2 box) |
| TLS | Let's Encrypt via certbot |
| Process supervisor | systemd |
| Hosting | Existing AWS EC2 instance, served from a subdomain |

Key non-choices, with rationale:
- **PixiJS not chosen** — Konva is plenty for VTT scale (a few dozen tokens) and `react-konva` makes the canvas declarative. Switch to Pixi only if a perf wall appears.
- **Plain JSON / LowDB / lokijs not chosen** — write-amplification and concurrency footguns for a real-time multiplayer app. SQLite WAL is fast and safe.
- **No Redux Toolkit** — Zustand has the same model with less boilerplate; sufficient for a single-store app.
- **No ORM** — plain SQL via `better-sqlite3`. Migrations are hand-written `.sql` files.
- **No argon2 in app** — DM password is gated by nginx Basic Auth (htpasswd), so app-side hashing is not needed.

## 4. Architecture

```
┌─────────────────────────────┐         ┌─────────────────────────────────────┐
│  Browser (DM or Player)     │  HTTPS  │  EC2 instance (vtt.<domain>)        │
│                             │ ──────▶ │                                     │
│  React + react-konva        │         │  nginx (TLS, Basic Auth, reverse    │
│  Socket.IO client           │ ◀─────▶ │         proxy, static + assets)     │
│                             │   WS    │  └─▶ Node process                   │
└─────────────────────────────┘         │       ├─ Express (HTTP API)         │
                                        │       ├─ Socket.IO server (WS)      │
                                        │       └─ better-sqlite3             │
                                        │                                     │
                                        │  /var/lib/vtt/                      │
                                        │    ├─ vtt.sqlite                    │
                                        │    └─ uploads/<hash>.{webp,thumb…}  │
                                        └─────────────────────────────────────┘
```

**Single Node process.** Express handles HTTP (auth bootstrap, asset upload, asset serving, page CRUD) and Socket.IO handles real-time sync. Both live in one process so they share the SQLite handle and in-memory caches. No microservices, no Redis, no clustering — all unnecessary at one-server-one-campaign scale.

**nginx in front.** Terminates TLS, provides Basic Auth on `/dm` and `/` (with separate htpasswd files), proxies API and WebSocket traffic to Node, serves the React static bundle and uploaded image assets directly from disk.

**SQLite is the single source of truth** for durable state. All reads can be served from in-memory caches; all writes go to SQLite first, then update cache, then broadcast.

**Filesystem holds binary assets** (images), keyed by content hash so uploads dedupe. SQLite stores asset metadata only.

**Trust model:** the server is authoritative. Clients propose changes (`token:move_commit`, `fog:stroke_commit`, etc.); the server validates against the actor's role and ownership, persists, and broadcasts. Clients are never trusted to filter their own visibility — sensitive data (hidden tokens, hidden HP) is stripped at the broadcast boundary so it never reaches an unauthorized client.

## 5. Data model

SQLite schema. Designed so that v2 features (dynamic lighting in particular) require **only additive migrations** — new tables and nullable columns, never altering existing rows.

```sql
-- Players that have joined (one row per friend who picks a name).
-- The DM does NOT have a row here — DM is identified solely by the vtt_dm cookie.
CREATE TABLE players (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color         TEXT NOT NULL,                -- hex string, used for highlight ring
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER
);

-- Uploaded image files. Content-hashed so identical re-uploads dedupe.
CREATE TABLE assets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  hash           TEXT NOT NULL UNIQUE,         -- sha256 of processed bytes
  kind           TEXT NOT NULL CHECK (kind IN ('map', 'token')),
  original_name  TEXT NOT NULL,
  mime           TEXT NOT NULL,                -- always 'image/webp' post-processing
  width          INTEGER NOT NULL,
  height         INTEGER NOT NULL,
  size_bytes     INTEGER NOT NULL,
  uploaded_at    INTEGER NOT NULL
);

-- A page = one map background + tokens + fog. is_active flags which page
-- is currently shown to players.
CREATE TABLE pages (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT NOT NULL,
  background_asset_id   INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  grid_width_squares    INTEGER NOT NULL,      -- DM-set logical dimensions
  grid_height_squares   INTEGER NOT NULL,
  sort_order            INTEGER NOT NULL,
  is_active             INTEGER NOT NULL DEFAULT 0,
  settings_json         TEXT NOT NULL DEFAULT '{}',  -- forward-compat extension
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

-- Enforce at most one active page at a time.
CREATE UNIQUE INDEX idx_pages_one_active ON pages(is_active) WHERE is_active = 1;

-- Tokens placed on a page.
CREATE TABLE tokens (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id                  INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  asset_id                 INTEGER NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  name                     TEXT,
  x                        REAL NOT NULL,    -- world coords (image pixels)
  y                        REAL NOT NULL,
  size_squares             INTEGER NOT NULL DEFAULT 1,
  owner_player_id          INTEGER REFERENCES players(id) ON DELETE SET NULL,
  hidden                   INTEGER NOT NULL DEFAULT 0,

  -- HP & conditions
  current_hp               INTEGER,           -- null = doesn't track HP
  max_hp                   INTEGER,
  conditions_json          TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  hp_visible_to_players    INTEGER NOT NULL DEFAULT 1,

  -- v2 stretch: dynamic lighting fields, ignored in v1
  vision_distance          REAL,              -- null = no LoS computed for this token
  light_radius             REAL,              -- null = doesn't emit light

  z_index                  INTEGER NOT NULL DEFAULT 0,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

-- Fog brush strokes. Vector-stored so the same data structure can be
-- composited with future dynamic-lighting visibility polygons.
CREATE TABLE fog_strokes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id      INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  mode         TEXT NOT NULL CHECK (mode IN ('reveal', 'hide')),
  radius       REAL NOT NULL,
  points_json  TEXT NOT NULL,                  -- JSON [[x,y],[x,y],...]
  created_at   INTEGER NOT NULL
);

-- v2 stretch: walls for dynamic line-of-sight. Empty in v1.
CREATE TABLE walls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id         INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  x1              REAL NOT NULL,
  y1              REAL NOT NULL,
  x2              REAL NOT NULL,
  y2              REAL NOT NULL,
  blocks_sight    INTEGER NOT NULL DEFAULT 1,
  blocks_movement INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_tokens_page  ON tokens(page_id);
CREATE INDEX idx_fog_page     ON fog_strokes(page_id);
CREATE INDEX idx_walls_page   ON walls(page_id);
CREATE INDEX idx_pages_sort   ON pages(sort_order);
```

### Modeling notes

- **Coordinates in image pixels.** A token's `(x, y)` is its center in the background image's native pixel space. The client computes grid cells at render time as `imageWidth / grid_width_squares`. This means changing `grid_width_squares` later does not move tokens visually relative to the map.
- **Integer token sizes only.** No half-tile creatures.
- **`hidden = 1` tokens are DM-only.** Server filters them out of every player-bound broadcast.
- **`owner_player_id NULL`** = DM-controlled (monsters, NPCs, scenery). Permission rule: a `token:move_commit` from a player is accepted only if `socket.data.role === 'dm' || token.owner_player_id === socket.data.playerId`.
- **`fog_strokes` is append-only.** Each completed brush motion = one row. "Clear all" deletes rows for that page.
- **`settings_json`** is the forward-compat valve for per-page settings that don't justify a column.
- **No sessions table.** Cookies are signed via HMAC and self-validating.
- **No campaign table.** Campaign name is an env var; the only piece of campaign-level state (active page) is captured via `pages.is_active`.

## 6. Real-time sync model

### Authentication on the socket

Auth happens once at WS handshake time, not per-event. The server middleware reads cookies, verifies HMAC signatures, and attaches role data to the socket:

```ts
io.use((socket, next) => {
  const cookies = parse(socket.handshake.headers.cookie || '');
  if (verifySignedCookie(cookies.vtt_dm)) {
    socket.data = { role: 'dm', name: 'DM', playerId: null };
    return next();
  }
  const playerId = verifySignedCookie(cookies.vtt_player_id);
  if (playerId !== null) {
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
    if (player) {
      socket.data = { role: 'player', name: player.name, playerId: player.id };
      return next();
    }
  }
  return next(new Error('not authenticated'));
});
```

After handshake, every event handler reads `socket.data` to decide what's allowed.

### Filtering at the broadcast boundary

Per-recipient payload generation. There is no `dm` room — broadcasts iterate connected sockets and emit role-appropriate payloads:

```ts
function broadcast<T>(buildPayload: (socket: Socket) => T | null, event: string) {
  for (const socket of io.sockets.sockets.values()) {
    const payload = buildPayload(socket);
    if (payload === null) continue;
    socket.emit(event, payload);
  }
}
```

For events where every recipient receives identical bytes (e.g., `player:joined`), `io.emit(...)` is fine.

**Filtering rules:**

- DM sockets receive full token records (including hidden, full HP, all pages' fog).
- Player sockets:
  - Tokens with `hidden = 1` → not broadcast at all to players.
  - Tokens with `hp_visible_to_players = 0` → broadcast with `current_hp` and `max_hp` set to `undefined`.
  - Fog data → only for the currently-active page; other pages' fog is never sent.

### Event taxonomy

**Client → server (commands):**

```
page:dm_navigate          DM only — DM's private preview, no broadcast (kept on socket
                          because in M6 it is throttled / repeated mid-prep)

token:create              DM only
token:update              DM (any field) | player (own token, x/y only)
token:delete              DM only
token:move_preview        throttled mid-drag, ephemeral, NO DB write
token:move_commit         drag-end, persists + broadcasts canonical state

fog:stroke_preview        DM only, mid-stroke ephemeral
fog:stroke_commit         DM only, persists + broadcasts canonical
fog:clear                 DM only

state:request_full_sync   on reconnect or initial load
```

**Note (revised in M3):** Page CRUD (`page:create`, `page:update`, `page:delete`, `page:set_active`) and asset CRUD are HTTP REST under `/api/dm/*` rather than socket commands. Asset upload requires HTTP (multipart); page CRUD is configuration-frequency, not interaction-frequency. Sockets are reserved for high-frequency interaction events (`token:move_*`, `fog:stroke_*`). The broadcast event names below (`page:created`, `state:active_page_changed`, etc.) are unchanged — they still arrive over Socket.IO. See `docs/superpowers/specs/2026-05-07-m3-design.md` §2.

**`state:full_sync`** is *introduced* in M3 with payload `{ activePage }` and *extended* in later milestones to add `tokens`, `fog`, and `players`. The shape listed below reflects the eventual full payload.

**Server → client (events):**

```
state:full_sync             initial / reconnect — { players, pages, activePageId, tokens, fog } (filtered)
state:active_page_changed   { pageId } — DM hit "Set Active"

page:created | page:updated | page:deleted

token:created | token:updated | token:deleted
token:moving                mid-drag relay (no DB), broadcast to others
token:moved                 canonical post-commit position

fog:stroking                mid-stroke relay (no DB), broadcast to others
fog:stroke_added            canonical post-commit
fog:cleared                 { pageId }

player:joined | player:left | player:list

error                       { code, message }
```

### The "moving" pattern (zero perceived input lag)

When the DM drags a token:

1. DM's own client renders the new position locally and immediately. No network on the hot path.
2. Throughout the drag, client emits `token:move_preview { id, x, y }` at ~30 Hz.
3. Server validates permissions, broadcasts `token:moving` to every other socket. **No DB write.**
4. On mouse-up, client emits `token:move_commit { id, x, y }`.
5. Server validates, writes to SQLite, broadcasts canonical `token:moved`.
6. Other clients reconcile: render the canonical position, replacing whatever interpolation they had.

Same pattern for fog brush strokes (`fog:stroke_preview` mid-stroke, `fog:stroke_commit` at end).

`better-sqlite3` writes in WAL mode are ~100 µs — well under one frame at 60 Hz — so the commit step contributes no perceptible lag.

### Reconnection

Socket.IO reconnects automatically. On reconnect, the client emits `state:request_full_sync`, the server resends the entire filtered state, and the client throws out its local state and rebuilds. No conflict resolution.

### Concurrency

Last-write-wins, FIFO per server. With one DM and 3–5 players who can only move their own tokens, conflicts are vanishingly rare. CRDTs / operational transform are unjustified at this scale.

### Client state management

A single Zustand store with slices for session, players, pages, active page id, DM private-preview page id, tokens grouped by page, and fog grouped by page. Socket event handlers (wired up once on app mount) call store actions. Components subscribe via Zustand selector hooks.

### Server in-memory caching

The server keeps a small in-memory cache of the active page's tokens and fog (re-read from SQLite on cold start). Writes go to DB first, then update cache, then broadcast — durable, then visible. Server crash + restart re-hydrates from SQLite cleanly.

## 7. Authentication & access control

### URLs and gates

```
vtt.<domain>/        → player entry. nginx Basic Auth with shared campaign password.
                       After auth, shows name picker if no vtt_player_id cookie.
vtt.<domain>/dm      → DM entry. nginx Basic Auth with DM-only password.
                       After auth, the DM bootstrap endpoint sets vtt_dm cookie.
```

### Cookies

Signed via HMAC with an `APP_SECRET` env var. No sessions table; the cookie value carries the data and the signature proves it wasn't tampered with.

```
vtt_player_id=<player_id>.<hmac>     30-day sliding expiry, HTTP-only, Secure, SameSite=Lax
vtt_dm=1.<hmac>                      same lifetime
```

The `APP_SECRET` is generated once at install with `openssl rand -hex 32` and lives in the systemd `EnvironmentFile`. Rotating the secret invalidates every cookie at once, which is the only revocation mechanism we have — fine for one campaign.

### DM flow (`/dm`)

1. Browser hits `/dm`. nginx returns 401 with Basic Auth challenge.
2. DM enters DM password. Browser caches credentials for that nginx realm.
3. nginx forwards the request to Node. The React shell loads.
4. React's DM bootstrap call: `GET /api/dm/bootstrap` (also nginx-Basic-Auth-protected) → server sets the signed `vtt_dm` cookie → returns 200.
5. React opens Socket.IO. Handshake reads the `vtt_dm` cookie, verifies, marks `socket.data.role = 'dm'`.

### Player flow (`/`)

1. Browser hits `/`. nginx returns 401 with Basic Auth challenge for the campaign password.
2. Player enters the shared campaign password. Browser caches it.
3. nginx forwards. React shell loads.
4. If no `vtt_player_id` cookie, React shows the name picker (name + color).
5. `POST /api/player/join { name, color }` → server checks name uniqueness (case-insensitive), creates or reuses a `players` row, sets the signed `vtt_player_id` cookie, returns the player record.
6. React opens Socket.IO. Handshake reads `vtt_player_id`, looks up the player, marks `socket.data.role = 'player'`.

### Setup

```bash
sudo htpasswd -c /etc/nginx/vtt-htpasswd-dm dm
sudo htpasswd -c /etc/nginx/vtt-htpasswd-players players
echo "APP_SECRET=$(openssl rand -hex 32)" | sudo tee -a /etc/vtt/env
```

Rotating either password is `htpasswd /etc/nginx/vtt-htpasswd-... <user>` — no Node restart required.

### Token-action authorization (recap)

Server-side checks on every command:

| Command | DM | Player |
| --- | --- | --- |
| `page:*`, `fog:*` | allowed | rejected |
| `token:create`, `token:delete`, `token:update` (full record) | allowed | rejected |
| `token:update` (only `x`, `y`) | allowed | allowed if `token.owner_player_id === socket.data.playerId` |
| `token:move_commit`, `token:move_preview` | allowed | same ownership check |

Rejections respond with an `error` event; the offending client is expected to discard its optimistic change and request `state:full_sync` to recover.

## 8. Asset upload & serving

### Upload pipeline

```
POST /api/dm/assets/upload   multipart/form-data
                             fields: file, kind ('token' | 'map')
                             DM-only (gated by nginx Basic Auth on /api/dm/*)
```

Synchronous handler:

1. Multer parses multipart with a 5 MB hard cap.
2. Detect mime from bytes (file-type lib). Reject if not `image/png`, `image/jpeg`, or `image/webp`.
3. `sharp(buffer).metadata()` to get dimensions. Reject if any dimension exceeds 8192 px (defense against malformed inputs).
4. Resize and re-encode:
   - Tokens: max 512 × 512, fit `inside`, output WebP quality 85.
   - Maps: max 4096 px on the longest side, output WebP quality 85.
5. `sha256(processed)` → `hash`. If a row with this hash already exists, return it (dedup, no further work).
6. Generate thumbnail: 128 × 128 for tokens, 256 × 256 for maps (cover fit), WebP.
7. Atomic write: temp file + rename into `uploads/<hash>.webp` and `uploads/<hash>.thumb.webp`.
8. `INSERT` the `assets` row.
9. Broadcast `asset:created` over Socket.IO so other DM tabs refresh their library panel.
10. Return `{ id, hash, kind, width, height, size_bytes, original_name }`.

### Serving

```
GET /assets/<hash>.webp
GET /assets/<hash>.thumb.webp
```

nginx serves these directly from `/var/lib/vtt/uploads/`, never touching Node. Because the path is content-hashed, response headers can include:

```
Cache-Control: public, max-age=31536000, immutable
```

### Deletion

```
DELETE /api/dm/assets/:id    DM-only (nginx Basic Auth gate)
```

Reject with `409` and a list of references if any `pages.background_asset_id` or `tokens.asset_id` points at the asset. The DM clears references and retries. Cascading delete is intentionally not supported — accidentally orphaning every map background with one click would be ruinous.

If unreferenced: delete both files, delete the DB row, broadcast `asset:deleted`.

### Security & quotas

- File extensions are never trusted; mime is detected from bytes.
- Stored filenames are derived from the hash; no user input touches the path. Path traversal is structurally impossible.
- `original_name` is HTML-escaped at render time.
- Rate limit: 10 uploads/minute per session.
- Disk quota check: refuse if `du uploads/ > 5 GB` (configurable). Sanity ceiling, far above realistic usage (~50 MB for a full campaign).

## 9. UI layout

### DM view

Left sidebar (vertical stack: Pages, Token Library, Map Library), thin top toolbar (Select / Fog / Page Settings), full canvas to the right.

- **Pages section** (top of sidebar): list of pages with the active page badged, click to DM-navigate (private preview), separate "Set Active" button to push to players, "+ New page" affordance.
- **Tokens library** (middle): grid of token thumbnails. "+ Upload" affordance. Drag a token onto the canvas to place it.
- **Maps library** (bottom): grid of map thumbnails. Used when creating a page (DM picks a map as the page background) or changing a page's background.
- **Top toolbar:** Select tool (default), Fog tool, Page Settings (for editing grid dimensions, page name).
- **Selected token popover:** when a token is selected on the canvas, a small floating popover appears next to it with name, owner, size, hidden flag, HP bar and editable HP, conditions strip with picker, HP-visibility toggle.
- **Fog tool dock:** when the Fog tool is active, a horizontal dock appears at the bottom of the canvas with Reveal / Hide / Clear mode buttons and a brush size slider. Disappears when switching back to Select.

### Player view

Full-bleed canvas. Thin top bar showing campaign / page name, the player's character name, and a list of other players currently online. No panels — players have nothing to manage beyond moving their own token. Pan (drag empty canvas), zoom (scroll), drag own token (snap, Alt for free).

Players see:
- The active page (set by DM)
- Visible tokens (no `hidden = 1` tokens)
- Fog reveals on the active page
- Their own token highlighted with a player-color ring
- Names of other online players

Players cannot see:
- Any other page (they don't even know other pages exist by name)
- Hidden tokens
- Fogged areas
- The asset library
- HP of tokens with `hp_visible_to_players = 0` (DM, monsters etc.)

Players cannot:
- Move other players' tokens
- Move DM-owned tokens
- Modify pages, fog, grid, or any settings

## 10. Deployment & operations

### File layout on the EC2 box

```
/etc/nginx/sites-available/vtt.conf           nginx site config
/etc/nginx/vtt-htpasswd-dm                    DM Basic Auth users
/etc/nginx/vtt-htpasswd-players               player Basic Auth users
/etc/systemd/system/vtt.service               service unit
/etc/vtt/env                                  env file (chmod 600, root:vtt)
/opt/vtt/                                     app install directory
  ├─ dist/                                    bundled server (esbuild output)
  ├─ public/                                  built client (vite build)
  ├─ package.json, node_modules
  └─ scripts/                                 admin CLIs (migrate, etc.)
/var/lib/vtt/                                 mutable data (chown vtt:vtt)
  ├─ vtt.sqlite (+ -wal, -shm)
  └─ uploads/<hash>.webp, <hash>.thumb.webp
/var/log/vtt/                                 captured stdout/stderr
```

### Environment

```sh
NODE_ENV=production
PORT=3000
APP_SECRET=<openssl rand -hex 32>
CAMPAIGN_NAME="<campaign name>"
DB_PATH=/var/lib/vtt/vtt.sqlite
UPLOADS_DIR=/var/lib/vtt/uploads
COOKIE_DOMAIN=vtt.<domain>
COOKIE_SECURE=1
TRUST_PROXY=1
```

### nginx config (essence)

- TLS via Let's Encrypt (certbot --nginx).
- `client_max_body_size 6m;` to permit 5 MB uploads with header headroom.
- Static React shell served from `/opt/vtt/public`.
- `/assets/` served directly from `/var/lib/vtt/uploads/` with `Cache-Control: public, max-age=31536000, immutable`.
- `/socket.io/` proxied to Node with `Upgrade`/`Connection` headers and `proxy_read_timeout 3600`.
- `/dm` and `/api/dm/` gated by `auth_basic` against `vtt-htpasswd-dm`.
- `/` and `/api/` gated by `auth_basic` against `vtt-htpasswd-players`.

### systemd service

```ini
[Unit]
Description=Virtual Tabletop
After=network.target

[Service]
Type=simple
User=vtt
Group=vtt
WorkingDirectory=/opt/vtt
EnvironmentFile=/etc/vtt/env
ExecStart=/usr/bin/node /opt/vtt/dist/server.js
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/vtt /var/log/vtt
PrivateTmp=true
StandardOutput=append:/var/log/vtt/app.log
StandardError=append:/var/log/vtt/app.log

[Install]
WantedBy=multi-user.target
```

Logs rotate via `/etc/logrotate.d/vtt` (10 MB/file, keep 14, compress).

### Build & deploy

The user already has a per-subdomain deploy script for this EC2 box. The VTT-specific bits the script needs to handle:

- **Pre-deploy on dev machine:** `npm run build` (server bundle + client bundle).
- **Transfer:** the built artifacts (whatever shape the existing script expects).
- **Post-deploy on EC2:**
  - `npm ci --omit=dev` in `/opt/vtt`.
  - `node /opt/vtt/scripts/migrate.js` (idempotent).
  - `systemctl restart vtt`.

The existing deploy script will be reviewed and adapted during M1.

### Migrations

Plain SQL files in `migrations/`, applied in order. A small migration runner (`scripts/migrate.ts`, ~50 lines using `better-sqlite3`) tracks applied migrations in a `_migrations` table and applies new ones idempotently. No ORM, no migration framework.

```
migrations/
  001_initial.sql              everything in §5 above
  002_add_walls_table.sql      v2
  003_add_token_vision.sql     v2
```

V2 features land as new migrations; existing migrations are never modified.

### Backups (deferred)

Not implemented in v1. If the EC2 instance is lost, the campaign state is lost. Map/token originals exist on the DM's local machine and can be re-uploaded. Acceptable for a hobby project.

If desired later: nightly `sqlite3 ... ".backup ..."` + `tar` of uploads, optionally rcloned off-box. ~10 lines of cron.

### Operational gotchas

- The Node user must have RW access to `vtt.sqlite`, `vtt.sqlite-wal`, and `vtt.sqlite-shm`.
- Never use `cp` to back up SQLite under WAL — only `.backup`.
- nginx default `client_max_body_size` is 1 MB and will silently 413 a 5 MB upload. Must be raised.
- `proxy_read_timeout` for `/socket.io/` must be longer than expected idle periods; 1 h is a sane floor.

## 11. Testing strategy

Three layers, focused on the spots most likely to bite. We are not chasing 100 % coverage; we are chasing confidence in auth, permission filtering, sync behavior, and the image pipeline.

### Unit tests (vitest) — server logic in isolation

- Cookie sign/verify round-trips, tampering rejection, wrong-secret rejection.
- `filterTokenForPlayer(...)` for hidden tokens, HP-hidden tokens, fully-visible tokens.
- `canPlayerMove(...)`, `canDMEdit(...)` permission predicates.
- `sharp` pipeline with fixture images: large PNG normalizes to a small WebP; a corrupt file rejects; an oversize image rejects.
- Migration runner: applies once, idempotent on re-run.

~30–50 tests, run in <1 s.

### Integration tests (vitest + supertest + in-memory SQLite)

- Full auth flow: bootstrap endpoint sets DM cookie; handshake recognizes it; bad cookie rejects.
- Asset upload pipeline: POST a fixture, expect 201 with metadata; GET `/assets/<hash>.webp` returns valid WebP bytes.
- Asset dedup: same fixture twice → single row.
- Token move broadcast across two sockets.
- Hidden token: DM creates with `hidden = 1`; player socket receives no `token:created`. DM updates same token; player still sees no events.
- HP visibility: token with `hp_visible_to_players = 0`; player receives the token without HP fields.
- Active page change broadcast.
- Reconnect + `state:request_full_sync` matches DB.

~15 tests, run in ~5 s total.

### Browser smoke tests (Playwright)

Three specs, end-to-end:

- DM logs in, uploads a map, creates a page, drags a token; the token visibly moves.
- Two-browser sync: DM moves a token in browser A, player in browser B sees it within 200 ms.
- Fog round-trip: DM paints fog, page reloads, fog persists.

Run in ~30 s.

### Explicitly not tested

- React component snapshot tests.
- Visual / CSS regression.
- Performance / load (4 players is far below any reasonable limit).

## 12. Milestone breakdown

Each milestone is roughly a focused weekend's work and ends with a demonstrable result.

**M1 — Skeleton & deploy harness.** Express + Socket.IO server returning "hello". React shell that connects via Socket.IO and shows "connected". Vite build, esbuild server bundle. nginx site config + systemd unit + deploy script adapted from existing per-subdomain pattern. TLS via certbot. *Done when:* deploy succeeds and `https://vtt.<domain>` shows "connected" via WS.

**M2 — Auth + name picker.** nginx Basic Auth on `/dm` and `/`. DM bootstrap endpoint that sets the signed `vtt_dm` cookie. Player name-picker form, signed `vtt_player_id` cookie. Socket.IO handshake reads cookies and marks role. Players table + signed-cookie verification. *Done when:* DM hits `/dm`, gets to a placeholder DM page with `role=dm`; player hits `/`, picks a name, gets to a placeholder player page with `role=player`.

**M3 — Pages, maps, asset upload.** Asset upload pipeline (sharp resize, dedup, WebP, thumbnails). Pages CRUD. DM library panel for maps. DM page sidebar with create / select / delete + "Set Active" button. Players see the active page background. *Done when:* DM uploads a map, creates a page, sets it active; players see that map (read-only, no grid/tokens yet).

**M4 — Grid, tokens, movement.** Grid overlay computed from `grid_width_squares × grid_height_squares`. Token upload and library. Drag tokens from the library onto the canvas. `token:move_preview` (mid-drag throttled) + `token:move_commit` (drag end, persisted). Snap-to-grid + Alt for free. Token ownership enforced: players can move their own token only. Token-properties popover: name, owner, size, hidden, HP, conditions. HP-visibility filtering server-side. Hidden-token filtering server-side. *Done when:* DM and player can drag tokens, see each other's moves in real time, ownership rules enforced.

**M5 — Fog of war.** Fog brush UI bottom dock (Reveal / Hide / Clear modes + brush size). `fog:stroke_preview` / `fog:stroke_commit` events. Vector fog rendering as a Konva mask layer. New pages default to fully fogged. Players see fog applied to the active page. *Done when:* DM paints fog reveals, players see only revealed areas, and fog persists across reload.

**M6 — Polish & playable.** DM private preview (`page:dm_navigate`). Player list / who's-online indicator. Reconnection handling and `state:full_sync` on reconnect. Selected-token highlight ring with player color. Player color picker on join. Error toasts for permission denials and upload failures. *Done when:* a real session has run end-to-end without major UX papercuts.

### Stretch (post-MVP)

- **M7 — Dynamic line-of-sight.** Walls table populated. Per-token vision computation. Visibility-polygon overlay layer composited on top of (and separate from) the v1 manual fog (which becomes the persistent "explored" layer).
- **M8 and beyond.** Whatever the first few sessions reveal as missing.

## 13. Forward-compatibility notes

The schema is designed so v2 features land as additive migrations only:

- `walls` table already exists, empty in v1.
- `tokens.vision_distance` and `tokens.light_radius` already exist as nullable columns, ignored in v1.
- `pages.settings_json` is the catch-all for new per-page settings.
- Future feature ideas (initiative tracker, condition duration tracking, character sheet integration, etc.) get new tables; existing rows are never modified.

The fog representation (vector strokes) is chosen so that v2 dynamic-lighting visibility polygons can be composited into the same render pipeline rather than fighting it.

Auth is decoupled from feature work. Adding a second DM is a second `htpasswd` line. Multi-campaign would be the only feature that requires non-trivial schema reshaping, and is explicitly out of scope.

## 14. Open items deferred to implementation planning

- The exact contents of the existing per-subdomain deploy script (review and adapt during M1).
- Concrete error-message copy and toast styling.
- Color palette for the player color picker.
- Minor UX details (e.g., page rename inline vs. modal, library thumbnail size).

These do not affect architecture and can be settled in the implementation plan.
