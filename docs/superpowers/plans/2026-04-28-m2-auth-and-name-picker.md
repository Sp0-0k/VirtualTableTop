# M2: Auth + Name Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the full authentication stack — Basic Auth at Caddy gating `/dm*` and `/`, signed-cookie role identification (DM vs. player), a `players` table, and a player name-picker — so subsequent milestones can rely on `socket.data.role` / `socket.data.playerId` for permission checks.

**Architecture:** Caddy `basic_auth` gates the entry HTML pages and the role-specific API namespaces. Once past Basic Auth, the server sets HMAC-signed cookies (`vtt_dm` / `vtt_player_id`). All subsequent role checks — both HTTP and Socket.IO — read those cookies. Socket.IO has NO Basic Auth gate at Caddy; the WS handshake is authenticated entirely via cookies, which is sufficient because cookies are HMAC-signed.

**Tech Stack additions:** `better-sqlite3` (SQLite), `cookie` (cookie header parser, peer dep of socket.io anyway). No `cookie-parser` middleware — we parse `req.headers.cookie` directly with the `cookie` package. No password hashing in app (Caddy handles that).

**M2 Done When:**
- Operator hits `https://vtt.5edice.com/dm`, gets DM Basic Auth prompt, enters DM password, page loads, JS calls `/api/dm/bootstrap`, cookie is set, Socket.IO connects, page shows `Role: DM`.
- Player hits `https://vtt.5edice.com/`, gets player Basic Auth prompt, enters shared password, page loads, fills out name picker, cookie is set, Socket.IO connects, page shows `Hi, <name>`.
- Reload either page → already-authenticated, no name picker re-shown, Socket.IO reconnects with same role.
- All tests pass (`npm test`), typecheck clean (`npm run typecheck`), production build succeeds (`npm run build`).

**Reference:** `docs/superpowers/specs/2026-04-27-vtt-design.md` is the design source of truth. §5 (data model), §6 (real-time sync auth), §7 (auth & access control) are the relevant sections.

**Conventions:**
- ESM everywhere; `.js` import suffixes on relative imports (esbuild + Node ESM requirement).
- TS strict; no `any`.
- Each task ends with one focused commit.
- Tests use in-memory SQLite (`:memory:`) for isolation; prod uses file-backed SQLite at `DB_PATH`.
- `APP_SECRET` is required at server startup — server crashes loudly if missing. Tests set it via a setup file.

---

## File Structure

Files this milestone creates or modifies. Each path appears in exactly one task's "Create" or "Modify" line.

```
/                                        (project root)
├── package.json                          modified Task 1 (deps)
├── package-lock.json                     modified Task 1 (regenerated)
├── .env.example                          Task 14
├── .gitignore                            modified Task 1 (.env, *.sqlite*)
├── ecosystem.config.cjs                  Task 14
├── vitest.config.ts                      modified Task 3 (setupFiles)
├── migrations/
│   └── 001_initial.sql                   Task 2
├── server/
│   └── src/
│       ├── server.ts                     modified Task 4 (accepts db)
│       ├── main.ts                       modified Task 4 (constructs db)
│       ├── socket.ts                     modified Task 11 (auth middleware)
│       ├── auth/
│       │   └── cookies.ts                Task 3 (HMAC sign/verify)
│       ├── db/
│       │   ├── connection.ts             Task 4 (DB factory)
│       │   ├── migrate.ts                Task 2 (migration runner)
│       │   └── players.ts                Task 8 (players model)
│       └── routes/
│           ├── health.ts                 (existing, unchanged)
│           ├── dm.ts                     Task 7 (GET /api/dm/bootstrap)
│           └── player.ts                 Task 9, modified Task 10
├── client/
│   ├── index.html                        (existing, unchanged)
│   └── src/
│       ├── main.tsx                      modified Task 12 (router)
│       ├── App.tsx                       modified Task 12 (path switch)
│       ├── socket.ts                     (existing, unchanged)
│       ├── api.ts                        Task 12 (typed fetch wrappers)
│       ├── DmApp.tsx                     Task 12
│       ├── PlayerApp.tsx                 Task 13
│       └── NamePicker.tsx                Task 13
├── tests/
│   ├── setup.ts                          Task 3 (env vars for tests)
│   ├── helpers/
│   │   └── testServer.ts                 Task 4 (in-memory db + server factory)
│   ├── health.test.ts                    (existing, unchanged)
│   ├── socket.test.ts                    rewritten Task 11
│   ├── cookies.test.ts                   Task 3
│   ├── migrate.test.ts                   Task 2
│   ├── dm-bootstrap.test.ts              Task 7
│   ├── player-join.test.ts               Task 9
│   └── me.test.ts                        Task 10
├── infra/
│   ├── caddy/
│   │   └── Caddyfile.vtt                 modified Task 15
│   └── scripts/
│       └── deploy.sh                     modified Task 15
└── docs/
    └── DEPLOY.md                         modified Task 16
```

**File responsibilities:**

- `migrations/001_initial.sql` — full v1 schema from spec §5 (players, assets, pages, tokens, fog_strokes, walls, all indexes). M2 only uses `players`; later milestones populate the rest. Per spec §13, this lands as one migration; future migrations are additive only.
- `server/src/auth/cookies.ts` — `signCookie(value)`, `verifyCookie(signed)` using HMAC-SHA-256 over `APP_SECRET`. Self-contained; no DB access.
- `server/src/db/connection.ts` — `createDb(path)` returns a `Database.Database` with WAL + foreign keys enabled. Tests pass `':memory:'`.
- `server/src/db/migrate.ts` — `runMigrations(db, dir)` reads `*.sql` files in `dir` in lexicographic order, applies each in a transaction, records applied filenames in a `_migrations` tracking table. Idempotent.
- `server/src/db/players.ts` — `findPlayerByName(db, name)`, `findPlayerById(db, id)`, `createPlayer(db, name, color)`. No HTTP concerns.
- `server/src/routes/dm.ts` — `dmRouter()` factory returning an Express router. Single route: `GET /bootstrap` → sets `vtt_dm` cookie, returns `{ ok: true }`. Mounted at `/api/dm` by `server.ts`.
- `server/src/routes/player.ts` — `playerRouter(db)` factory. Routes: `POST /join` (creates/reuses player, sets cookie), `GET /me` (returns `{ role, player? }` based on cookies). Mounted at `/api` by `server.ts`.
- `server/src/socket.ts` — Socket.IO with auth middleware that reads cookies and rejects unauthenticated handshakes. After accept, attaches `socket.data = { role, playerId, name }`.
- `client/src/api.ts` — small typed wrappers: `getMe()`, `joinAsPlayer(name, color)`, `bootstrapDm()`. Uses `fetch` with `credentials: 'include'`.
- `client/src/DmApp.tsx` — DM placeholder: calls `bootstrapDm()` on mount, then renders `Role: DM` and Socket.IO status.
- `client/src/PlayerApp.tsx` — Player root: calls `getMe()` on mount; if `anon`, renders `<NamePicker />`; if `player`, renders `Hi, {name}` and Socket.IO status.
- `client/src/NamePicker.tsx` — form: name input + color picker. Submits via `joinAsPlayer`; on success, parent re-renders.
- `client/src/App.tsx` — routes by `window.location.pathname`: `/dm` → `<DmApp />`, anything else → `<PlayerApp />`. Hash router would be overkill for two pages.
- `tests/helpers/testServer.ts` — `createTestServer()` returns `{ server, db, url }`: spins up an in-memory DB with migrations applied + `createServer(db)` listening on port 0; returns the live URL for clients to connect.
- `infra/caddy/Caddyfile.vtt` — adds `basic_auth` blocks gating `/dm*` and `/api/dm/*` (DM password) and `/` and `/api/*` (player password). `/socket.io/*` is unauthenticated at Caddy. Strips `Authorization` header on reverse_proxy so app never sees Basic Auth creds.
- `ecosystem.config.cjs` — pm2 config with `node_args: '--env-file=.env'`. Replaces the inline `pm2 start dist/server.js` in deploy.sh.

---

## Task 1: Add dependencies and ignore patterns

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (regenerated)
- Modify: `.gitignore`

- [ ] **Step 1: Read current `package.json`**

Run: `cat package.json`
Note the existing dependencies and devDependencies blocks; we will add to both.

- [ ] **Step 2: Edit `package.json` to add `better-sqlite3` and `cookie`**

In the `dependencies` block, add:
```json
    "better-sqlite3": "^11.3.0",
    "cookie": "^0.7.0"
```

In the `devDependencies` block, add:
```json
    "@types/better-sqlite3": "^7.6.0",
    "@types/cookie": "^0.6.0"
```

The full `dependencies` object should now be (alphabetized for sanity):
```json
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "cookie": "^0.7.0",
    "express": "^4.21.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "socket.io": "^4.8.0",
    "socket.io-client": "^4.8.0"
  },
```

The full `devDependencies` object should now be:
```json
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/cookie": "^0.6.0",
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/supertest": "^6.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "esbuild": "^0.24.0",
    "supertest": "^7.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  },
```

- [ ] **Step 3: Update `.gitignore`**

Run: `cat .gitignore`

Append the following lines if not already present:
```
.env
.env.local
*.sqlite
*.sqlite-wal
*.sqlite-shm
```

The `.env.example` template (added in Task 14) is committed; only the real `.env` is ignored.

- [ ] **Step 4: Install dependencies**

Run: `npm install`

Expected: completes successfully. `package-lock.json` updates. `node_modules/better-sqlite3/` exists.

If `better-sqlite3` fails to build (it has a native compile step on first install), Kirk's box has the toolchain, but inside this dev env you may need `npm install --build-from-source` or the prebuilt binary will fetch automatically. Just retry once if the first attempt fails on a network error.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: add better-sqlite3 and cookie deps for M2 auth"
```

---

## Task 2: Migration runner and initial schema (TDD)

**Files:**
- Create: `migrations/001_initial.sql`
- Create: `server/src/db/migrate.ts`
- Create: `tests/migrate.test.ts`

- [ ] **Step 1: Create `migrations/001_initial.sql` with the full §5 schema**

```sql
-- Players that have joined (one row per friend who picks a name).
-- The DM does NOT have a row here — DM is identified solely by the vtt_dm cookie.
CREATE TABLE players (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER
);

-- Uploaded image files. Content-hashed so identical re-uploads dedupe.
CREATE TABLE assets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  hash           TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL CHECK (kind IN ('map', 'token')),
  original_name  TEXT NOT NULL,
  mime           TEXT NOT NULL,
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
  grid_width_squares    INTEGER NOT NULL,
  grid_height_squares   INTEGER NOT NULL,
  sort_order            INTEGER NOT NULL,
  is_active             INTEGER NOT NULL DEFAULT 0,
  settings_json         TEXT NOT NULL DEFAULT '{}',
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_pages_one_active ON pages(is_active) WHERE is_active = 1;

-- Tokens placed on a page.
CREATE TABLE tokens (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id                  INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  asset_id                 INTEGER NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  name                     TEXT,
  x                        REAL NOT NULL,
  y                        REAL NOT NULL,
  size_squares             INTEGER NOT NULL DEFAULT 1,
  owner_player_id          INTEGER REFERENCES players(id) ON DELETE SET NULL,
  hidden                   INTEGER NOT NULL DEFAULT 0,
  current_hp               INTEGER,
  max_hp                   INTEGER,
  conditions_json          TEXT NOT NULL DEFAULT '[]',
  hp_visible_to_players    INTEGER NOT NULL DEFAULT 1,
  vision_distance          REAL,
  light_radius             REAL,
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
  points_json  TEXT NOT NULL,
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

- [ ] **Step 2: Write the failing test (`tests/migrate.test.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/src/db/migrate.js';

describe('runMigrations', () => {
  it('creates the players table on a fresh db', () => {
    const db = new Database(':memory:');
    runMigrations(db, 'migrations');
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='players'")
      .get();
    expect(row).toEqual({ name: 'players' });
  });

  it('records applied migrations in the _migrations table', () => {
    const db = new Database(':memory:');
    runMigrations(db, 'migrations');
    const rows = db
      .prepare('SELECT filename FROM _migrations ORDER BY filename')
      .all();
    expect(rows).toEqual([{ filename: '001_initial.sql' }]);
  });

  it('is idempotent on a second run', () => {
    const db = new Database(':memory:');
    runMigrations(db, 'migrations');
    runMigrations(db, 'migrations'); // should not throw
    const rows = db.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('creates all v1 tables from the spec', () => {
    const db = new Database(':memory:');
    runMigrations(db, 'migrations');
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    expect(rows).toEqual([
      { name: '_migrations' },
      { name: 'assets' },
      { name: 'fog_strokes' },
      { name: 'pages' },
      { name: 'players' },
      { name: 'tokens' },
      { name: 'walls' },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/migrate.test.ts`

Expected: FAIL — module `'../server/src/db/migrate.js'` not found.

- [ ] **Step 4: Implement the migration runner (`server/src/db/migrate.ts`)**

```ts
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database, migrationsDir: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    db
      .prepare('SELECT filename FROM _migrations')
      .all()
      .map((r) => (r as { filename: string }).filename),
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const recordApplied = db.prepare(
    'INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)',
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      recordApplied.run(file, Date.now());
    });
    apply();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/migrate.test.ts`

Expected: PASS, 4 tests in 1 suite.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add migrations/ server/src/db/migrate.ts tests/migrate.test.ts
git commit -m "feat(db): add migration runner with v1 initial schema"
```

---

## Task 3: HMAC cookie sign/verify helpers (TDD)

**Files:**
- Create: `tests/setup.ts`
- Modify: `vitest.config.ts`
- Create: `server/src/auth/cookies.ts`
- Create: `tests/cookies.test.ts`

- [ ] **Step 1: Create `tests/setup.ts`**

```ts
// Set required env vars before any module imports them.
process.env.APP_SECRET = 'test-secret-do-not-use-in-prod';
```

- [ ] **Step 2: Update `vitest.config.ts` to load the setup file**

Replace the file's contents with:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
  },
});
```

- [ ] **Step 3: Write the failing test (`tests/cookies.test.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import { signCookie, verifyCookie } from '../server/src/auth/cookies.js';

describe('cookie sign/verify', () => {
  it('round-trips a value through sign and verify', () => {
    const signed = signCookie('hello');
    expect(verifyCookie(signed)).toBe('hello');
  });

  it('round-trips a numeric-looking value', () => {
    const signed = signCookie('42');
    expect(verifyCookie(signed)).toBe('42');
  });

  it('rejects undefined', () => {
    expect(verifyCookie(undefined)).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(verifyCookie('')).toBeNull();
  });

  it('rejects a malformed cookie with no separator', () => {
    expect(verifyCookie('justavalue')).toBeNull();
  });

  it('rejects a tampered value', () => {
    const signed = signCookie('hello');
    const tampered = signed.replace(/^hello/, 'world');
    expect(verifyCookie(tampered)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const signed = signCookie('hello');
    const tampered = signed.slice(0, -1) + (signed.slice(-1) === '0' ? '1' : '0');
    expect(verifyCookie(tampered)).toBeNull();
  });

  it('rejects a value signed with a different secret', () => {
    const signed = signCookie('hello');
    process.env.APP_SECRET = 'different-secret';
    try {
      expect(verifyCookie(signed)).toBeNull();
    } finally {
      process.env.APP_SECRET = 'test-secret-do-not-use-in-prod';
    }
  });

  it('throws if APP_SECRET is unset', () => {
    const original = process.env.APP_SECRET;
    delete process.env.APP_SECRET;
    try {
      expect(() => signCookie('x')).toThrow(/APP_SECRET/);
    } finally {
      process.env.APP_SECRET = original;
    }
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- tests/cookies.test.ts`

Expected: FAIL — module `'../server/src/auth/cookies.js'` not found.

- [ ] **Step 5: Implement `server/src/auth/cookies.ts`**

```ts
import crypto from 'node:crypto';

function getSecret(): string {
  const s = process.env.APP_SECRET;
  if (!s) throw new Error('APP_SECRET env var is required');
  return s;
}

export function signCookie(value: string): string {
  const sig = crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
  return `${value}.${sig}`;
}

export function verifyCookie(signed: string | undefined): string | null {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
      return null;
    }
  } catch {
    return null;
  }
  return value;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/cookies.test.ts`

Expected: PASS, 9 tests in 1 suite.

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add tests/setup.ts vitest.config.ts server/src/auth/cookies.ts tests/cookies.test.ts
git commit -m "feat(auth): add HMAC cookie sign/verify helpers"
```

---

## Task 4: DB connection module + refactor createServer to accept db

**Files:**
- Create: `server/src/db/connection.ts`
- Modify: `server/src/server.ts` (accept db, no behavior change yet)
- Modify: `server/src/main.ts` (construct db, run migrations, pass to server)
- Create: `tests/helpers/testServer.ts`
- Modify: `tests/health.test.ts` (use new helper)
- Modify: `tests/socket.test.ts` (use new helper, will be rewritten in Task 11 anyway)

- [ ] **Step 1: Create `server/src/db/connection.ts`**

```ts
import Database from 'better-sqlite3';

export function createDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
```

- [ ] **Step 2: Modify `server/src/server.ts` to accept a db parameter**

Replace the file contents with:

```ts
import express from 'express';
import http from 'node:http';
import type Database from 'better-sqlite3';
import healthRouter from './routes/health.js';
import { attachSocketIO } from './socket.js';

export interface ServerDeps {
  db: Database.Database;
}

export function createServer(deps: ServerDeps): http.Server {
  const app = express();

  app.use(express.json());
  app.use('/api/health', healthRouter);

  const httpServer = http.createServer(app);
  attachSocketIO(httpServer, deps);

  return httpServer;
}
```

- [ ] **Step 3: Update `server/src/socket.ts` signature so the existing M1 behaviour still works**

Read `server/src/socket.ts`. Modify the signature to accept the deps object but ignore the db for now — we'll wire the auth middleware in Task 11.

Replace contents with:

```ts
import type http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import type Database from 'better-sqlite3';

export interface SocketDeps {
  db: Database.Database;
}

export function attachSocketIO(httpServer: http.Server, _deps: SocketDeps): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: false },
  });

  io.on('connection', (socket) => {
    socket.emit('hello', { greeting: 'connected' });
  });

  return io;
}
```

The `_deps` underscore signals "intentionally unused for now". Task 11 removes the underscore and uses it.

- [ ] **Step 4: Modify `server/src/main.ts` to construct the db and run migrations**

Replace contents with:

```ts
import path from 'node:path';
import { createDb } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { createServer } from './server.js';

const dbPath = process.env.DB_PATH ?? path.resolve('dev.sqlite');
const migrationsDir = process.env.MIGRATIONS_DIR ?? path.resolve('migrations');

const db = createDb(dbPath);
runMigrations(db, migrationsDir);

const server = createServer({ db });
const port = Number(process.env.PORT ?? 3002);
server.listen(port, () => {
  console.log(`vtt server listening on :${port}`);
});
```

- [ ] **Step 5: Create `tests/helpers/testServer.ts`**

```ts
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/src/db/migrate.js';
import { createServer } from '../../server/src/server.js';

export interface TestServer {
  server: Server;
  db: Database.Database;
  url: string;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, 'migrations');

  const server = createServer({ db });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    server,
    db,
    url: `http://localhost:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}
```

- [ ] **Step 6: Update `tests/health.test.ts` to use the helper**

Replace the file contents with:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, type TestServer } from './helpers/testServer.js';

describe('GET /api/health', () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startTestServer();
  });

  afterAll(async () => {
    await ts.close();
  });

  it('returns 200 with { ok: true }', async () => {
    const res = await request(ts.server).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 7: Update `tests/socket.test.ts` minimally to use the helper**

(Full rewrite happens in Task 11 once auth middleware lands. For now, keep the M1 hello-event behaviour passing.)

Replace contents with:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { startTestServer, type TestServer } from './helpers/testServer.js';

describe('Socket.IO server (pre-auth, M1 behavior)', () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startTestServer();
  });

  afterAll(async () => {
    await ts.close();
  });

  it('emits hello on client connect', () => {
    return new Promise<void>((resolve, reject) => {
      const client: ClientSocket = ioc(ts.url, { transports: ['websocket'] });
      const timer = setTimeout(() => {
        client.close();
        reject(new Error('timed out waiting for hello'));
      }, 2000);

      client.on('hello', (msg: { greeting: string }) => {
        try {
          expect(msg).toEqual({ greeting: 'connected' });
          clearTimeout(timer);
          client.close();
          resolve();
        } catch (err) {
          reject(err as Error);
        }
      });
    });
  });
});
```

- [ ] **Step 8: Run all tests**

Run: `npm test`

Expected: PASS — 4 suites (cookies, health, migrate, socket), all green.

- [ ] **Step 9: Run typecheck**

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 10: Smoke-run the dev server**

Set a temp APP_SECRET and run:

```bash
APP_SECRET=devsecret npm run dev:server
```

Expected: console prints `vtt server listening on :3002`. A `dev.sqlite` file appears in the cwd. `curl http://localhost:3002/api/health` returns `{"ok":true}`. Stop with Ctrl-C.

(The APP_SECRET is required *eventually* — Task 7 will be the first route that touches it. Setting it now keeps dev workflow uncluttered.)

- [ ] **Step 11: Commit**

```bash
git add server/src/db/connection.ts server/src/server.ts server/src/socket.ts server/src/main.ts tests/helpers/ tests/health.test.ts tests/socket.test.ts
git commit -m "refactor(server): inject db into createServer; add testServer helper"
```

---

## Task 5: Cookie helpers wired into Express response (TDD)

**Files:**
- Create: `server/src/auth/express-cookies.ts`
- Create: `tests/express-cookies.test.ts`

This task adds two thin Express helpers — `setSignedCookie(res, name, value, opts)` and `readSignedCookie(req, name)` — so route handlers don't reimplement cookie header parsing each time. Keeping them separate from the pure HMAC `signCookie/verifyCookie` so those stay framework-free.

- [ ] **Step 1: Write the failing test (`tests/express-cookies.test.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import http from 'node:http';
import request from 'supertest';
import {
  setSignedCookie,
  readSignedCookie,
} from '../server/src/auth/express-cookies.js';

function makeApp() {
  const app = express();
  app.get('/set', (_req, res) => {
    setSignedCookie(res, 'vtt_test', 'abc', { maxAgeSeconds: 60 });
    res.json({ ok: true });
  });
  app.get('/read', (req, res) => {
    res.json({ value: readSignedCookie(req, 'vtt_test') });
  });
  return app;
}

describe('signed cookie express helpers', () => {
  it('round-trips a value via Set-Cookie + Cookie header', async () => {
    const app = makeApp();
    const setRes = await request(app).get('/set');
    expect(setRes.status).toBe(200);
    const setCookie = setRes.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieHeader = (Array.isArray(setCookie) ? setCookie : [setCookie])
      .map((c: string) => c.split(';')[0])
      .join('; ');

    const readRes = await request(app).get('/read').set('Cookie', cookieHeader);
    expect(readRes.body).toEqual({ value: 'abc' });
  });

  it('returns null for a missing cookie', async () => {
    const app = makeApp();
    const res = await request(app).get('/read');
    expect(res.body).toEqual({ value: null });
  });

  it('returns null for a tampered cookie', async () => {
    const res = await request(makeApp())
      .get('/read')
      .set('Cookie', 'vtt_test=tampered.deadbeef');
    expect(res.body).toEqual({ value: null });
  });

  it('Set-Cookie has HttpOnly, SameSite=Lax, Path=/', async () => {
    const setRes = await request(makeApp()).get('/set');
    const raw = setRes.headers['set-cookie']!;
    const cookie = (Array.isArray(raw) ? raw[0] : raw) as string;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/express-cookies.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/auth/express-cookies.ts`**

```ts
import type { Request, Response } from 'express';
import * as cookie from 'cookie';
import { signCookie, verifyCookie } from './cookies.js';

export interface SetCookieOpts {
  maxAgeSeconds: number;
  secure?: boolean;
}

export function setSignedCookie(
  res: Response,
  name: string,
  value: string,
  opts: SetCookieOpts,
): void {
  const signed = signCookie(value);
  const secure = opts.secure ?? process.env.COOKIE_SECURE === '1';
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(name, signed, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: opts.maxAgeSeconds,
    }),
  );
}

export function readSignedCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const parsed = cookie.parse(header);
  return verifyCookie(parsed[name]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/express-cookies.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add server/src/auth/express-cookies.ts tests/express-cookies.test.ts
git commit -m "feat(auth): add Express helpers for setting/reading signed cookies"
```

---

## Task 6: Cookie name + lifetime constants

**Files:**
- Create: `server/src/auth/constants.ts`

Centralizes cookie names and the 30-day lifetime so they don't drift between routes and the socket middleware.

- [ ] **Step 1: Create `server/src/auth/constants.ts`**

```ts
export const COOKIE_DM = 'vtt_dm';
export const COOKIE_PLAYER = 'vtt_player_id';

// 30 days in seconds — used for Max-Age. Per spec §7: "30-day sliding expiry".
// We don't actively slide; re-issuing on /api/me and /api/dm/bootstrap is enough.
export const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
```

- [ ] **Step 2: Commit**

```bash
git add server/src/auth/constants.ts
git commit -m "feat(auth): centralize cookie name + lifetime constants"
```

---

## Task 7: DM bootstrap route (TDD)

**Files:**
- Create: `server/src/routes/dm.ts`
- Modify: `server/src/server.ts` (mount router)
- Create: `tests/dm-bootstrap.test.ts`

- [ ] **Step 1: Write the failing test (`tests/dm-bootstrap.test.ts`)**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { verifyCookie } from '../server/src/auth/cookies.js';
import { COOKIE_DM } from '../server/src/auth/constants.js';

function extractCookie(setCookieHeader: string | string[] | undefined, name: string): string | null {
  if (!setCookieHeader) return null;
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const raw of arr) {
    const first = raw.split(';')[0];
    const [k, v] = first.split('=');
    if (k === name) return v;
  }
  return null;
}

describe('GET /api/dm/bootstrap', () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startTestServer();
  });

  afterAll(async () => {
    await ts.close();
  });

  it('returns { ok: true }', async () => {
    const res = await request(ts.server).get('/api/dm/bootstrap');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('sets a signed vtt_dm cookie with HttpOnly + SameSite=Lax', async () => {
    const res = await request(ts.server).get('/api/dm/bootstrap');
    const setCookie = res.headers['set-cookie'];
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookie).toMatch(new RegExp(`^${COOKIE_DM}=`));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);

    const value = extractCookie(setCookie, COOKIE_DM);
    expect(value).toBeTruthy();
    expect(verifyCookie(decodeURIComponent(value!))).toBe('1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/dm-bootstrap.test.ts`

Expected: FAIL — `Cannot GET /api/dm/bootstrap` (404), since no router is mounted yet.

- [ ] **Step 3: Implement `server/src/routes/dm.ts`**

```ts
import { Router } from 'express';
import { setSignedCookie } from '../auth/express-cookies.js';
import { COOKIE_DM, COOKIE_MAX_AGE } from '../auth/constants.js';

export function dmRouter(): Router {
  const router = Router();

  router.get('/bootstrap', (_req, res) => {
    setSignedCookie(res, COOKIE_DM, '1', { maxAgeSeconds: COOKIE_MAX_AGE });
    res.json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 4: Mount the router in `server/src/server.ts`**

Add an import:

```ts
import { dmRouter } from './routes/dm.js';
```

Add the mount line, after `app.use('/api/health', healthRouter);`:

```ts
  app.use('/api/dm', dmRouter());
```

The full server.ts now reads:

```ts
import express from 'express';
import http from 'node:http';
import type Database from 'better-sqlite3';
import healthRouter from './routes/health.js';
import { dmRouter } from './routes/dm.js';
import { attachSocketIO } from './socket.js';

export interface ServerDeps {
  db: Database.Database;
}

export function createServer(deps: ServerDeps): http.Server {
  const app = express();

  app.use(express.json());
  app.use('/api/health', healthRouter);
  app.use('/api/dm', dmRouter());

  const httpServer = http.createServer(app);
  attachSocketIO(httpServer, deps);

  return httpServer;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/dm-bootstrap.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 6: Run all tests**

Run: `npm test`

Expected: PASS, all suites green.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/dm.ts server/src/server.ts tests/dm-bootstrap.test.ts
git commit -m "feat(server): add /api/dm/bootstrap route that sets vtt_dm cookie"
```

---

## Task 8: Players model (TDD)

**Files:**
- Create: `server/src/db/players.ts`
- Create: `tests/players.test.ts`

- [ ] **Step 1: Write the failing test (`tests/players.test.ts`)**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/src/db/migrate.js';
import {
  createPlayer,
  findPlayerById,
  findPlayerByName,
  type Player,
} from '../server/src/db/players.js';

describe('players model', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, 'migrations');
  });

  it('creates a player with createdAt timestamp', () => {
    const p = createPlayer(db, 'Alice', '#aa3344');
    expect(p.id).toBeGreaterThan(0);
    expect(p.name).toBe('Alice');
    expect(p.color).toBe('#aa3344');
    expect(p.createdAt).toBeGreaterThan(0);
  });

  it('finds a player by id', () => {
    const created = createPlayer(db, 'Bob', '#3344aa');
    const found = findPlayerById(db, created.id);
    expect(found).toEqual<Player>(created);
  });

  it('returns null for non-existent id', () => {
    expect(findPlayerById(db, 999)).toBeNull();
  });

  it('finds a player by exact name', () => {
    const created = createPlayer(db, 'Charlie', '#aabb33');
    const found = findPlayerByName(db, 'Charlie');
    expect(found?.id).toBe(created.id);
  });

  it('finds a player by case-insensitive name', () => {
    const created = createPlayer(db, 'Delta', '#33aabb');
    const found = findPlayerByName(db, 'DELTA');
    expect(found?.id).toBe(created.id);
  });

  it('returns null for non-existent name', () => {
    expect(findPlayerByName(db, 'nobody')).toBeNull();
  });

  it('createPlayer throws on duplicate case-insensitive name', () => {
    createPlayer(db, 'Echo', '#a1b2c3');
    expect(() => createPlayer(db, 'ECHO', '#000000')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/players.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/db/players.ts`**

```ts
import type Database from 'better-sqlite3';

export interface Player {
  id: number;
  name: string;
  color: string;
  createdAt: number;
  lastSeenAt: number | null;
}

interface PlayerRow {
  id: number;
  name: string;
  color: string;
  created_at: number;
  last_seen_at: number | null;
}

function rowToPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function createPlayer(db: Database.Database, name: string, color: string): Player {
  const now = Date.now();
  const info = db
    .prepare('INSERT INTO players (name, color, created_at) VALUES (?, ?, ?)')
    .run(name, color, now);
  return {
    id: Number(info.lastInsertRowid),
    name,
    color,
    createdAt: now,
    lastSeenAt: null,
  };
}

export function findPlayerById(db: Database.Database, id: number): Player | null {
  const row = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as PlayerRow | undefined;
  return row ? rowToPlayer(row) : null;
}

export function findPlayerByName(db: Database.Database, name: string): Player | null {
  const row = db
    .prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE')
    .get(name) as PlayerRow | undefined;
  return row ? rowToPlayer(row) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/players.test.ts`

Expected: PASS, 7 tests.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/players.ts tests/players.test.ts
git commit -m "feat(db): add players model (create, findById, findByName)"
```

---

## Task 9: Player join route (TDD)

**Files:**
- Create: `server/src/routes/player.ts`
- Modify: `server/src/server.ts` (mount router)
- Create: `tests/player-join.test.ts`

- [ ] **Step 1: Write the failing test (`tests/player-join.test.ts`)**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { verifyCookie } from '../server/src/auth/cookies.js';
import { COOKIE_PLAYER } from '../server/src/auth/constants.js';

function getCookie(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const raw = headers['set-cookie'];
  if (!raw) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  for (const c of arr) {
    const first = c.split(';')[0];
    const [k, v] = first.split('=');
    if (k === name) return v;
  }
  return null;
}

describe('POST /api/player/join', () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startTestServer();
  });

  afterAll(async () => {
    await ts.close();
  });

  it('creates a new player and sets vtt_player_id cookie', async () => {
    const res = await request(ts.server)
      .post('/api/player/join')
      .send({ name: 'Alice', color: '#a1b2c3' });

    expect(res.status).toBe(200);
    expect(res.body.player).toMatchObject({
      name: 'Alice',
      color: '#a1b2c3',
    });
    expect(typeof res.body.player.id).toBe('number');

    const cookieValue = getCookie(res.headers, COOKIE_PLAYER);
    expect(cookieValue).toBeTruthy();
    const verified = verifyCookie(decodeURIComponent(cookieValue!));
    expect(verified).toBe(String(res.body.player.id));
  });

  it('returns the existing row on case-insensitive name re-join', async () => {
    const first = await request(ts.server)
      .post('/api/player/join')
      .send({ name: 'Bob', color: '#abcdef' });
    const firstId = first.body.player.id;

    const second = await request(ts.server)
      .post('/api/player/join')
      .send({ name: 'BOB', color: '#000000' });

    expect(second.status).toBe(200);
    expect(second.body.player.id).toBe(firstId);
    expect(second.body.player.name).toBe('Bob');     // original casing preserved
    expect(second.body.player.color).toBe('#abcdef'); // original color preserved
  });

  it('rejects empty name with 400', async () => {
    const res = await request(ts.server)
      .post('/api/player/join')
      .send({ name: '', color: '#aaaaaa' });
    expect(res.status).toBe(400);
  });

  it('rejects name longer than 20 chars with 400', async () => {
    const res = await request(ts.server)
      .post('/api/player/join')
      .send({ name: 'x'.repeat(21), color: '#aaaaaa' });
    expect(res.status).toBe(400);
  });

  it('rejects malformed color with 400', async () => {
    const res = await request(ts.server)
      .post('/api/player/join')
      .send({ name: 'Carol', color: 'red' });
    expect(res.status).toBe(400);
  });

  it('rejects missing fields with 400', async () => {
    const res = await request(ts.server).post('/api/player/join').send({});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/player-join.test.ts`

Expected: FAIL — `Cannot POST /api/player/join` (404).

- [ ] **Step 3: Implement `server/src/routes/player.ts`**

```ts
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { setSignedCookie } from '../auth/express-cookies.js';
import { COOKIE_PLAYER, COOKIE_MAX_AGE } from '../auth/constants.js';
import { createPlayer, findPlayerByName } from '../db/players.js';

const NAME_MIN = 1;
const NAME_MAX = 20;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function playerRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/player/join', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const color = typeof req.body?.color === 'string' ? req.body.color : '';

    if (name.length < NAME_MIN || name.length > NAME_MAX) {
      res.status(400).json({ error: 'name must be 1-20 characters' });
      return;
    }
    if (!COLOR_RE.test(color)) {
      res.status(400).json({ error: 'color must be a 6-digit hex string like #a1b2c3' });
      return;
    }

    const existing = findPlayerByName(db, name);
    const player = existing ?? createPlayer(db, name, color);

    setSignedCookie(res, COOKIE_PLAYER, String(player.id), {
      maxAgeSeconds: COOKIE_MAX_AGE,
    });

    res.json({ player });
  });

  return router;
}
```

- [ ] **Step 4: Mount the router in `server/src/server.ts`**

Add import:

```ts
import { playerRouter } from './routes/player.js';
```

Add mount line after the dmRouter mount:

```ts
  app.use('/api', playerRouter(deps.db));
```

The router internally has paths like `/player/join`, so the full path is `/api/player/join`. ✓

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/player-join.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 6: Run all tests**

Run: `npm test`

Expected: PASS across all suites.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/player.ts server/src/server.ts tests/player-join.test.ts
git commit -m "feat(server): add /api/player/join route with name+color validation"
```

---

## Task 10: GET /api/me route (TDD)

**Files:**
- Modify: `server/src/routes/player.ts` (add /me route)
- Create: `tests/me.test.ts`

- [ ] **Step 1: Write the failing test (`tests/me.test.ts`)**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, type TestServer } from './helpers/testServer.js';

async function joinAsPlayer(ts: TestServer, name: string, color: string): Promise<string> {
  const res = await request(ts.server).post('/api/player/join').send({ name, color });
  const setCookie = res.headers['set-cookie'];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie!];
  return arr.map((c: string) => c.split(';')[0]).join('; ');
}

async function bootstrapDm(ts: TestServer): Promise<string> {
  const res = await request(ts.server).get('/api/dm/bootstrap');
  const setCookie = res.headers['set-cookie'];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie!];
  return arr.map((c: string) => c.split(';')[0]).join('; ');
}

describe('GET /api/me', () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startTestServer();
  });

  afterAll(async () => {
    await ts.close();
  });

  it('returns role=anon when no cookies are present', async () => {
    const res = await request(ts.server).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ role: 'anon' });
  });

  it('returns role=player with the player record when vtt_player_id is set', async () => {
    const cookie = await joinAsPlayer(ts, 'Pia', '#445566');
    const res = await request(ts.server).get('/api/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('player');
    expect(res.body.player).toMatchObject({ name: 'Pia', color: '#445566' });
  });

  it('returns role=dm when vtt_dm cookie is set', async () => {
    const cookie = await bootstrapDm(ts);
    const res = await request(ts.server).get('/api/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ role: 'dm' });
  });

  it('prefers DM role when both cookies are present', async () => {
    const playerCookie = await joinAsPlayer(ts, 'Quincy', '#778899');
    const dmCookie = await bootstrapDm(ts);
    const combined = `${playerCookie}; ${dmCookie}`;
    const res = await request(ts.server).get('/api/me').set('Cookie', combined);
    expect(res.body).toEqual({ role: 'dm' });
  });

  it('returns role=anon when player cookie is signed but the id no longer exists', async () => {
    // Sign a fake player id that doesn't exist in the db.
    const { signCookie } = await import('../server/src/auth/cookies.js');
    const fakeCookie = `vtt_player_id=${encodeURIComponent(signCookie('99999'))}`;
    const res = await request(ts.server).get('/api/me').set('Cookie', fakeCookie);
    expect(res.body).toEqual({ role: 'anon' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/me.test.ts`

Expected: FAIL — `GET /api/me` returns 404.

- [ ] **Step 3: Add the `/me` route to `server/src/routes/player.ts`**

Add these imports at the top of the file (alongside existing imports):

```ts
import { COOKIE_DM, COOKIE_PLAYER, COOKIE_MAX_AGE } from '../auth/constants.js';
import { readSignedCookie } from '../auth/express-cookies.js';
import { findPlayerById, findPlayerByName, createPlayer } from '../db/players.js';
```

(Replace any duplicate imports with the union.)

Inside the `playerRouter` function, before `return router;`, add:

```ts
  router.get('/me', (req, res) => {
    if (readSignedCookie(req, COOKIE_DM) === '1') {
      res.json({ role: 'dm' });
      return;
    }
    const playerId = readSignedCookie(req, COOKIE_PLAYER);
    if (playerId !== null) {
      const player = findPlayerById(db, Number(playerId));
      if (player) {
        res.json({ role: 'player', player });
        return;
      }
    }
    res.json({ role: 'anon' });
  });
```

The full updated `server/src/routes/player.ts` should be:

```ts
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { setSignedCookie, readSignedCookie } from '../auth/express-cookies.js';
import { COOKIE_DM, COOKIE_PLAYER, COOKIE_MAX_AGE } from '../auth/constants.js';
import { createPlayer, findPlayerById, findPlayerByName } from '../db/players.js';

const NAME_MIN = 1;
const NAME_MAX = 20;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function playerRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/player/join', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const color = typeof req.body?.color === 'string' ? req.body.color : '';

    if (name.length < NAME_MIN || name.length > NAME_MAX) {
      res.status(400).json({ error: 'name must be 1-20 characters' });
      return;
    }
    if (!COLOR_RE.test(color)) {
      res.status(400).json({ error: 'color must be a 6-digit hex string like #a1b2c3' });
      return;
    }

    const existing = findPlayerByName(db, name);
    const player = existing ?? createPlayer(db, name, color);

    setSignedCookie(res, COOKIE_PLAYER, String(player.id), {
      maxAgeSeconds: COOKIE_MAX_AGE,
    });

    res.json({ player });
  });

  router.get('/me', (req, res) => {
    if (readSignedCookie(req, COOKIE_DM) === '1') {
      res.json({ role: 'dm' });
      return;
    }
    const playerId = readSignedCookie(req, COOKIE_PLAYER);
    if (playerId !== null) {
      const player = findPlayerById(db, Number(playerId));
      if (player) {
        res.json({ role: 'player', player });
        return;
      }
    }
    res.json({ role: 'anon' });
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/me.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Run all tests**

Run: `npm test`

Expected: PASS, all suites.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/player.ts tests/me.test.ts
git commit -m "feat(server): add /api/me route returning current role+player"
```

---

## Task 11: Socket.IO auth middleware (TDD)

**Files:**
- Modify: `server/src/socket.ts` (replace M1 hello with auth)
- Rewrite: `tests/socket.test.ts`

- [ ] **Step 1: Rewrite `tests/socket.test.ts`**

Replace the file's contents with:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { startTestServer, type TestServer } from './helpers/testServer.js';

async function joinAsPlayer(ts: TestServer, name: string, color: string): Promise<string> {
  const res = await request(ts.server).post('/api/player/join').send({ name, color });
  const setCookie = res.headers['set-cookie'];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie!];
  return arr.map((c: string) => c.split(';')[0]).join('; ');
}

async function bootstrapDm(ts: TestServer): Promise<string> {
  const res = await request(ts.server).get('/api/dm/bootstrap');
  const setCookie = res.headers['set-cookie'];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie!];
  return arr.map((c: string) => c.split(';')[0]).join('; ');
}

function connect(url: string, cookie?: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioc(url, {
      transports: ['websocket'],
      extraHeaders: cookie ? { Cookie: cookie } : {},
      reconnection: false,
    });
    const timer = setTimeout(() => {
      client.close();
      reject(new Error('connect timeout'));
    }, 2000);
    client.on('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('Socket.IO auth handshake', () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startTestServer();
  });

  afterAll(async () => {
    await ts.close();
  });

  it('rejects connections without a cookie', async () => {
    await expect(connect(ts.url)).rejects.toThrow(/not authenticated/i);
  });

  it('rejects connections with a tampered cookie', async () => {
    await expect(connect(ts.url, 'vtt_dm=1.deadbeef')).rejects.toThrow(/not authenticated/i);
  });

  it('accepts a DM connection and emits session info', async () => {
    const cookie = await bootstrapDm(ts);
    const client = await connect(ts.url, cookie);
    const session = await new Promise<{ role: string; name: string }>((resolve) => {
      client.on('session', resolve);
    });
    expect(session.role).toBe('dm');
    expect(session.name).toBe('DM');
    client.close();
  });

  it('accepts a player connection and emits session info with player data', async () => {
    const cookie = await joinAsPlayer(ts, 'Riley', '#112233');
    const client = await connect(ts.url, cookie);
    const session = await new Promise<{ role: string; name: string; playerId: number }>(
      (resolve) => {
        client.on('session', resolve);
      },
    );
    expect(session.role).toBe('player');
    expect(session.name).toBe('Riley');
    expect(typeof session.playerId).toBe('number');
    client.close();
  });

  it('rejects a player cookie whose id no longer exists', async () => {
    const { signCookie } = await import('../server/src/auth/cookies.js');
    const fakeCookie = `vtt_player_id=${encodeURIComponent(signCookie('99999'))}`;
    await expect(connect(ts.url, fakeCookie)).rejects.toThrow(/not authenticated/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/socket.test.ts`

Expected: FAIL — current socket.ts has no auth middleware, so the unauthenticated case unexpectedly succeeds (and the others fail because no `session` event is emitted).

- [ ] **Step 3: Replace `server/src/socket.ts` with auth-aware version**

```ts
import type http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import * as cookie from 'cookie';
import type Database from 'better-sqlite3';
import { verifyCookie } from './auth/cookies.js';
import { COOKIE_DM, COOKIE_PLAYER } from './auth/constants.js';
import { findPlayerById } from './db/players.js';

export interface SocketDeps {
  db: Database.Database;
}

export type SessionData =
  | { role: 'dm'; name: 'DM'; playerId: null }
  | { role: 'player'; name: string; playerId: number };

declare module 'socket.io' {
  interface Socket {
    data: SessionData;
  }
}

export function attachSocketIO(httpServer: http.Server, deps: SocketDeps): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: false },
  });

  io.use((socket, next) => {
    const cookies = cookie.parse(socket.handshake.headers.cookie ?? '');

    if (verifyCookie(cookies[COOKIE_DM]) === '1') {
      socket.data = { role: 'dm', name: 'DM', playerId: null };
      return next();
    }

    const playerIdStr = verifyCookie(cookies[COOKIE_PLAYER]);
    if (playerIdStr !== null) {
      const player = findPlayerById(deps.db, Number(playerIdStr));
      if (player) {
        socket.data = { role: 'player', name: player.name, playerId: player.id };
        return next();
      }
    }

    return next(new Error('not authenticated'));
  });

  io.on('connection', (socket) => {
    socket.emit('session', socket.data);
  });

  return io;
}
```

- [ ] **Step 4: Run socket test to verify it passes**

Run: `npm test -- tests/socket.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Run all tests**

Run: `npm test`

Expected: PASS across all suites.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add server/src/socket.ts tests/socket.test.ts
git commit -m "feat(server): authenticate Socket.IO handshake via signed cookies"
```

---

## Task 12: Client — DM page

**Files:**
- Create: `client/src/api.ts`
- Create: `client/src/DmApp.tsx`
- Modify: `client/src/App.tsx` (path-based routing skeleton)

- [ ] **Step 1: Create `client/src/api.ts`**

```ts
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
```

- [ ] **Step 2: Create `client/src/DmApp.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import { bootstrapDm } from './api.js';

type Phase = 'bootstrapping' | 'connecting' | 'connected' | 'error';

export default function DmApp() {
  const [phase, setPhase] = useState<Phase>('bootstrapping');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    bootstrapDm()
      .then(() => {
        if (cancelled) return;
        setPhase('connecting');
        socket.connect();
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setPhase('error');
      });

    const onConnect = () => setPhase('connected');
    const onDisconnect = () => setPhase('connecting');
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      cancelled = true;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Virtual Tabletop — DM</h1>
      {phase === 'bootstrapping' && <p>Authenticating&hellip;</p>}
      {phase === 'connecting' && <p>Connecting&hellip;</p>}
      {phase === 'connected' && <p>Role: <strong>DM</strong></p>}
      {phase === 'error' && <p style={{ color: 'crimson' }}>Error: {error}</p>}
    </main>
  );
}
```

- [ ] **Step 3: Modify `client/src/socket.ts` to disable autoConnect**

The DM page calls `bootstrapDm()` *before* it wants the socket to connect. With `autoConnect: true` (M1 default), the socket connects on import — too early, before the cookie is set.

Read `client/src/socket.ts` and replace its contents with:

```ts
import { io, type Socket } from 'socket.io-client';

// Same-origin connection. Vite dev server proxies /socket.io to the API server.
// In production, Caddy does the same. Auth happens on the WS handshake via
// the signed cookies the page already received from /api/dm/bootstrap or
// /api/player/join, so we explicitly defer connection until after that.
export const socket: Socket = io({
  transports: ['websocket'],
  autoConnect: false,
});
```

- [ ] **Step 4: Modify `client/src/App.tsx` to route by pathname**

Replace its contents with:

```tsx
import DmApp from './DmApp.js';
import PlayerApp from './PlayerApp.js';

function isDmPath(): boolean {
  return window.location.pathname.startsWith('/dm');
}

export default function App() {
  return isDmPath() ? <DmApp /> : <PlayerApp />;
}
```

(`PlayerApp` is created in Task 13 — TS will fail typecheck until then. We commit at the end of Task 13.)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

Expected: FAIL on missing `./PlayerApp.js`. That's expected; commit happens after Task 13 lands the file.

- [ ] **Step 6: No commit yet — Task 13 finishes the client and we commit together**

---

## Task 13: Client — Name picker + Player page

**Files:**
- Create: `client/src/NamePicker.tsx`
- Create: `client/src/PlayerApp.tsx`

- [ ] **Step 1: Create `client/src/NamePicker.tsx`**

```tsx
import { useState } from 'react';
import { joinAsPlayer, type Player } from './api.js';

const COLORS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71',
  '#1abc9c', '#3498db', '#9b59b6', '#e84393',
];

interface Props {
  onJoined: (player: Player) => void;
}

export default function NamePicker({ onJoined }: Props) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[5]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const player = await joinAsPlayer(name.trim(), color);
      onJoined(player);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 400 }}>
      <h2>Pick a name</h2>
      <label style={{ display: 'block', marginBottom: '0.5rem' }}>
        Name:
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          required
          autoFocus
          style={{ marginLeft: '0.5rem', padding: '0.25rem' }}
        />
      </label>
      <fieldset style={{ border: 'none', padding: 0, marginBottom: '0.5rem' }}>
        <legend>Color:</legend>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`color ${c}`}
              aria-pressed={color === c}
              style={{
                width: 32,
                height: 32,
                background: c,
                border: color === c ? '3px solid #000' : '1px solid #ccc',
                borderRadius: '50%',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      </fieldset>
      <button type="submit" disabled={submitting || name.trim().length === 0}>
        {submitting ? 'Joining…' : 'Join'}
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Create `client/src/PlayerApp.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import { getMe, type Player } from './api.js';
import NamePicker from './NamePicker.js';

type Phase = 'loading' | 'name-picker' | 'connecting' | 'connected';

export default function PlayerApp() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [player, setPlayer] = useState<Player | null>(null);

  useEffect(() => {
    getMe()
      .then((me) => {
        if (me.role === 'player') {
          setPlayer(me.player);
          setPhase('connecting');
          socket.connect();
        } else if (me.role === 'dm') {
          // We're at /, but we're authed as DM — treat like a connected DM
          setPhase('connecting');
          socket.connect();
        } else {
          setPhase('name-picker');
        }
      })
      .catch(() => setPhase('name-picker'));

    const onConnect = () => setPhase('connected');
    const onDisconnect = () => setPhase('connecting');
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  function handleJoined(p: Player) {
    setPlayer(p);
    setPhase('connecting');
    socket.connect();
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Virtual Tabletop</h1>
      {phase === 'loading' && <p>Loading&hellip;</p>}
      {phase === 'name-picker' && <NamePicker onJoined={handleJoined} />}
      {phase === 'connecting' && <p>Connecting{player ? ` as ${player.name}` : ''}&hellip;</p>}
      {phase === 'connected' && (
        <p>
          Hi, <strong style={{ color: player?.color }}>{player?.name ?? 'DM'}</strong>!
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 4: Smoke-test in the browser**

In one terminal:

```bash
APP_SECRET=devsecret npm run dev:server
```

In another:

```bash
npm run dev:client
```

Open `http://localhost:5173/` (the player route). Expected: name picker appears. Submit a name. Page should show `Hi, <name>!`.

Open a new private window and visit `http://localhost:5173/dm`. Expected: page shows `Role: DM`.

(We don't have Caddy in dev, so Basic Auth gates aren't tested here — that comes in the deploy verification step.)

Stop both dev servers.

- [ ] **Step 5: Run all tests**

Run: `npm test`

Expected: PASS across all suites.

- [ ] **Step 6: Commit Tasks 12 and 13 together**

```bash
git add client/src/api.ts client/src/socket.ts client/src/App.tsx client/src/DmApp.tsx client/src/NamePicker.tsx client/src/PlayerApp.tsx
git commit -m "feat(client): add DM bootstrap, player name-picker, /api/me-driven routing"
```

---

## Task 14: pm2 ecosystem file + .env.example

**Files:**
- Create: `ecosystem.config.cjs`
- Create: `.env.example`
- Modify: `README.md` (dev env hint)

- [ ] **Step 1: Create `ecosystem.config.cjs`**

```js
// pm2 config for the VTT app on EC2.
// Used by infra/scripts/deploy.sh — `pm2 startOrReload ecosystem.config.cjs`.
//
// node_args: --env-file loads .env (sibling of dist/, in /home/ubuntu/services/vtt/)
// at process start, so APP_SECRET et al. land in process.env without sourcing
// shell rc files.

module.exports = {
  apps: [
    {
      name: 'vtt',
      script: 'dist/server.js',
      node_args: '--env-file=.env',
      env: {
        NODE_ENV: 'production',
      },
      max_restarts: 10,
      restart_delay: 2000,
    },
  ],
};
```

- [ ] **Step 2: Create `.env.example`**

```
# Copy to .env in dev (or /home/ubuntu/services/vtt/.env in prod) and fill in.
# Generate APP_SECRET with: openssl rand -hex 32
APP_SECRET=

# Port the Node process listens on. Caddy reverse-proxies to this port.
PORT=3002

# SQLite database file. Relative paths resolve from cwd.
DB_PATH=vtt.sqlite

# Where to read .sql migration files from. Relative paths resolve from cwd.
MIGRATIONS_DIR=migrations

# Set to 1 in production so cookies require HTTPS.
COOKIE_SECURE=1

# Pretty name shown in the UI later (M3+).
CAMPAIGN_NAME=The Campaign
```

- [ ] **Step 3: Update `README.md` development section**

Read current README. Replace the `## Development` section with:

```markdown
## Development

```bash
cp .env.example .env
# Edit .env and set APP_SECRET to anything (e.g. `openssl rand -hex 32`).

npm install
npm run dev:server   # in one terminal — listens on :3002
npm run dev:client   # in another — Vite dev server on :5173, proxies API
```

The Vite dev server proxies `/api` and `/socket.io` to :3002, so open
`http://localhost:5173/` (player view) or `http://localhost:5173/dm` (DM view).
There is no Basic Auth gate in dev — that's a Caddy concern, exercised only in prod.
```

- [ ] **Step 4: Smoke-run the production build to verify ecosystem.config.cjs path is right**

```bash
echo "APP_SECRET=$(openssl rand -hex 32)" > .env
npm run build
node --env-file=.env dist/server.js
```

Expected: starts up, listens on :3002. Stop with Ctrl-C.

(Don't commit `.env` — it's in .gitignore.)

- [ ] **Step 5: Commit**

```bash
git add ecosystem.config.cjs .env.example README.md
git commit -m "chore: add pm2 ecosystem config and .env.example"
```

---

## Task 15: Caddyfile + deploy script for auth

**Files:**
- Modify: `infra/caddy/Caddyfile.vtt`
- Modify: `infra/scripts/deploy.sh`

- [ ] **Step 1: Replace `infra/caddy/Caddyfile.vtt` with the auth-aware version**

The order of `handle` blocks matters: Caddy evaluates them top-down and the first match wins. So the more specific `/api/dm/*` block must come before `/api/*`, and `/dm*` before the catch-all.

```caddyfile
# Caddy site block for vtt.5edice.com.
# Paste this into your existing Caddyfile (or import it via `import` directive).
# Caddy will provision a TLS cert automatically on first request.
#
# Auth model:
#   /dm and /api/dm/*  → basic_auth with the DM password
#   / and /api/*       → basic_auth with the shared player password
#   /socket.io/*       → no basic_auth; the WebSocket handshake authenticates
#                         via the signed cookies set by /api/dm/bootstrap
#                         and /api/player/join. Cookies are HMAC-signed, so
#                         the WS gate is sufficient on its own.
#
# Generate password hashes with `caddy hash-password` and paste them below.
# `header_up -Authorization` strips the Basic Auth credentials before
# reverse-proxying, so the Node app never sees them.

vtt.5edice.com {
    encode gzip

    # DM API: gated by DM Basic Auth; proxied to Node.
    handle /api/dm/* {
        basic_auth {
            dm <DM_PASSWORD_HASH>
        }
        reverse_proxy localhost:3002 {
            header_up -Authorization
        }
    }

    # Other API routes: gated by player Basic Auth; proxied to Node.
    handle /api/* {
        basic_auth {
            player <PLAYER_PASSWORD_HASH>
        }
        reverse_proxy localhost:3002 {
            header_up -Authorization
        }
    }

    # Socket.IO: NOT gated by Basic Auth — cookie-on-handshake is the gate.
    # Caddy v2's reverse_proxy supports WebSocket upgrades automatically.
    handle /socket.io/* {
        reverse_proxy localhost:3002 {
            header_up -Authorization
        }
    }

    # DM SPA: gated by DM Basic Auth.
    handle /dm* {
        basic_auth {
            dm <DM_PASSWORD_HASH>
        }
        root * /home/ubuntu/services/vtt/public
        try_files {path} /index.html
        file_server
    }

    # Everything else (player SPA).
    handle {
        basic_auth {
            player <PLAYER_PASSWORD_HASH>
        }
        root * /home/ubuntu/services/vtt/public
        try_files {path} /index.html
        file_server
    }
}
```

- [ ] **Step 2: Replace `infra/scripts/deploy.sh`**

The new version: ships `migrations/` and `ecosystem.config.cjs`, preserves the on-box `.env`, runs migrations once via `node --env-file=.env dist/server.js` is unnecessary because `main.ts` calls `runMigrations` at startup — the pm2 startOrReload will trigger that automatically.

```bash
#!/usr/bin/env bash
# Deploy VTT to EC2.
# Adapted from CS260's deployService.sh — pm2-managed, runs as `ubuntu`,
# lives at ~/services/vtt/.
#
# Usage:
#   bash infra/scripts/deploy.sh -k <pem key> -h <hostname> [-s <service>]
#
# Service name defaults to `vtt`. Hostname is the public DNS / subdomain.
#
# IMPORTANT: this preserves the on-box .env and vtt.sqlite — those are
# never overwritten. First-time deploy: SSH in and create .env from
# .env.example before running this.

set -euo pipefail

service=vtt

while getopts k:h:s: flag; do
    case "${flag}" in
        k) key=${OPTARG};;
        h) hostname=${OPTARG};;
        s) service=${OPTARG};;
        *) ;;
    esac
done

if [[ -z "${key:-}" || -z "${hostname:-}" ]]; then
    echo "syntax: deploy.sh -k <pem key> -h <hostname> [-s <service>]"
    exit 1
fi

echo "----> Deploying $service to $hostname"

echo "----> Building"
npm ci
npm run build

echo "----> Staging deployment package"
rm -rf build
mkdir build
cp -r dist build/dist
cp -r public build/public
cp -r migrations build/migrations
cp ecosystem.config.cjs build/
cp package.json package-lock.json build/

echo "----> Syncing to remote (preserves .env and *.sqlite*)"
ssh -i "$key" ubuntu@"$hostname" "mkdir -p services/$service"
# rsync with --delete-excluded gives us a clean install of code while keeping
# the operator-managed .env and the live database files.
rsync -az --delete \
    --exclude='.env' \
    --exclude='*.sqlite' \
    --exclude='*.sqlite-wal' \
    --exclude='*.sqlite-shm' \
    --exclude='node_modules' \
    -e "ssh -i $key" \
    build/ ubuntu@"$hostname":services/"$service"/

echo "----> Installing deps and (re)starting pm2 process"
ssh -i "$key" ubuntu@"$hostname" << ENDSSH
bash -i
cd services/$service
if [[ ! -f .env ]]; then
    echo "ERROR: services/$service/.env is missing on the host." >&2
    echo "       Copy .env.example, fill in APP_SECRET, then re-run deploy." >&2
    exit 1
fi
npm ci --omit=dev
pm2 startOrReload ecosystem.config.cjs
pm2 save
ENDSSH

rm -rf build
echo "----> Done. Verify: curl https://$hostname/api/health"
```

Note: the change from `scp -r` to `rsync` is what lets us preserve the on-box `.env` and SQLite files. If `rsync` isn't installed on Kirk's dev machine, install it (`sudo apt install rsync`) — it's a one-time setup cost.

- [ ] **Step 3: Sanity-check bash syntax**

Run: `bash -n infra/scripts/deploy.sh`

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add infra/caddy/Caddyfile.vtt infra/scripts/deploy.sh
git commit -m "infra: gate /dm and / with Basic Auth in Caddy; preserve .env on deploy"
```

---

## Task 16: Update DEPLOY.md for M2

**Files:**
- Modify: `docs/DEPLOY.md`

- [ ] **Step 1: Read current `docs/DEPLOY.md`**

Run: `cat docs/DEPLOY.md`

Note its current structure — it covers M1's nginx-era setup. We're replacing it.

- [ ] **Step 2: Replace `docs/DEPLOY.md` with the M2 version**

```markdown
# Deployment

Production target: AWS EC2 instance under the `vtt.5edice.com` subdomain,
behind Caddy with auto-TLS, supervised by pm2 as the `ubuntu` user.

## One-time host setup (M2)

Run on the EC2 box.

1. **Install dependencies** (skip any already present):

   ```bash
   sudo apt update
   sudo apt install -y caddy nodejs rsync
   sudo npm install -g pm2
   ```

2. **Generate Basic Auth password hashes** (Caddy uses bcrypt). On any
   machine with Caddy installed, run:

   ```bash
   caddy hash-password
   ```

   You'll be prompted twice for a password and given back a `$2a$...` hash.
   Generate one for the DM password and one for the shared player password.

3. **Install the Caddy site config:**

   ```bash
   sudo mkdir -p /etc/caddy/sites
   sudo cp /path/to/repo/infra/caddy/Caddyfile.vtt /etc/caddy/sites/vtt.conf
   sudo nano /etc/caddy/sites/vtt.conf
   ```

   Replace `<DM_PASSWORD_HASH>` and `<PLAYER_PASSWORD_HASH>` with the bcrypt
   strings from step 2. Each placeholder appears in 2 places — search and
   replace all.

   Make sure the main `/etc/caddy/Caddyfile` includes this directory:

   ```
   import /etc/caddy/sites/*.conf
   ```

   Validate and reload:

   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

4. **Create the service directory and `.env`:**

   ```bash
   mkdir -p ~/services/vtt
   cp /path/to/repo/.env.example ~/services/vtt/.env
   chmod 600 ~/services/vtt/.env
   nano ~/services/vtt/.env
   ```

   Set `APP_SECRET` to the output of `openssl rand -hex 32`. Set
   `COOKIE_SECURE=1` (cookies will only flow over HTTPS in prod).

5. **Confirm pm2 starts at boot:**

   ```bash
   pm2 startup
   # paste the command pm2 prints
   ```

## Build & deploy

From your dev machine:

```bash
bash infra/scripts/deploy.sh -k ~/.ssh/your-ec2-key.pem -h vtt.5edice.com
```

The script:

- Builds (`npm ci && npm run build`)
- rsyncs `dist/`, `public/`, `migrations/`, `ecosystem.config.cjs`,
  `package.json`, `package-lock.json` to `~/services/vtt/`
- Preserves the existing `.env` and `vtt.sqlite*` on the host
- Runs `npm ci --omit=dev` on the host
- Runs `pm2 startOrReload ecosystem.config.cjs && pm2 save`

The migration runner runs at server startup — no separate migration step.

## First-deploy verification

After deploying:

```bash
curl https://vtt.5edice.com/api/health
# → 401 (Basic Auth challenge from Caddy — this is correct)

curl -u player:<player-password> https://vtt.5edice.com/api/health
# → {"ok":true}
```

In a browser:

1. Visit `https://vtt.5edice.com/dm`. Browser prompts for credentials. Use
   `dm` as the username and the DM password.
2. Page loads, JS calls `/api/dm/bootstrap`, cookie is set, page shows
   `Role: DM`.
3. Open another browser (or private window) and visit `https://vtt.5edice.com/`.
   Prompt for player credentials (`player` + shared password).
4. Page loads, name-picker appears. Submit a name.
5. Page shows `Hi, <name>!`.

## Troubleshooting

- `pm2 logs vtt` — Node process logs.
- `sudo journalctl -u caddy -n 100` — Caddy logs.
- `sudo caddy validate --config /etc/caddy/Caddyfile` — config check.
- If APP_SECRET isn't set, the Node process exits at startup with a clear
  error. Check `~/services/vtt/.env`.
- If you see `WebSocket connection failed`, confirm the `/socket.io/` block
  is in the Caddy site config and that `pm2 status` shows vtt running.

## Rotating credentials

- **Basic Auth password:** generate a new bcrypt hash with `caddy
  hash-password`, paste into `/etc/caddy/sites/vtt.conf`,
  `sudo systemctl reload caddy`. No Node restart needed.
- **APP_SECRET:** edit `~/services/vtt/.env`, then `pm2 restart vtt`. This
  invalidates *all* existing signed cookies — every connected DM/player
  must re-authenticate. That's the only revocation lever we have.

## What this milestone (M2) does NOT include

- Asset upload pipeline (sharp, image dedup) — M3.
- Pages / map management — M3.
- Tokens, drag-to-move, ownership rules — M4.
- Fog of war — M5.
- DM private preview, reconnect resync — M6.

These land in subsequent plans.
```

- [ ] **Step 3: Commit**

```bash
git add docs/DEPLOY.md
git commit -m "docs: rewrite DEPLOY.md for M2 (Caddy basic_auth + pm2 + .env)"
```

---

## Task 17: First M2 deploy and end-to-end verification

This task is partly manual.

- [ ] **Step 1: SSH to EC2 and confirm the on-box `.env` is set up**

```bash
ssh -i <key> ubuntu@vtt.5edice.com
cat ~/services/vtt/.env
```

If `.env` doesn't exist yet, follow `docs/DEPLOY.md` step 4 to create it. **Generate APP_SECRET fresh** — do not reuse a dev secret.

- [ ] **Step 2: Confirm Caddy has the new site config with real password hashes**

```bash
sudo grep -E 'DM_PASSWORD_HASH|PLAYER_PASSWORD_HASH' /etc/caddy/sites/vtt.conf
```

Expected: no matches (placeholders have been replaced with real `$2a$...` hashes).

If matches are found, generate hashes via `caddy hash-password` and replace.

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

- [ ] **Step 3: Run the deploy script**

From dev machine:

```bash
bash infra/scripts/deploy.sh -k ~/.ssh/<your-key>.pem -h vtt.5edice.com
```

Expected: builds, rsyncs, runs `npm ci --omit=dev` on host, pm2 (re)starts. No errors. Final line: `Done. Verify: curl https://vtt.5edice.com/api/health`.

- [ ] **Step 4: Verify Basic Auth challenge**

```bash
curl -i https://vtt.5edice.com/api/health
```

Expected: HTTP/2 401 with `www-authenticate: Basic realm="restricted"`.

- [ ] **Step 5: Verify player Basic Auth → 200**

```bash
curl -u player:<player-password> https://vtt.5edice.com/api/health
```

Expected: `{"ok":true}`.

- [ ] **Step 6: Verify DM bootstrap sets a cookie**

```bash
curl -i -u dm:<dm-password> https://vtt.5edice.com/api/dm/bootstrap
```

Expected: HTTP/2 200 with a `set-cookie: vtt_dm=1.<long-hmac>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` header. The cookie should also be marked `Secure` (because `COOKIE_SECURE=1` in `.env`).

- [ ] **Step 7: Verify the full DM flow in a browser**

Open `https://vtt.5edice.com/dm` in a fresh private window. Enter `dm` + DM password. Expected: page shows `Role: DM`.

Devtools → Application → Cookies → confirm `vtt_dm` is set.
Devtools → Network → filter WS → confirm `/socket.io/...` is upgraded (status 101) and stays open.

- [ ] **Step 8: Verify the full player flow in a browser**

Open `https://vtt.5edice.com/` in a different private window. Enter `player` + player password. Expected: name-picker appears. Submit a name. Page shows `Hi, <name>!`.

- [ ] **Step 9: Verify reload behavior**

In each browser window, hit reload. Expected: no name-picker re-shown for the player; both pages reconnect Socket.IO and end up in the connected state again.

- [ ] **Step 10: Verify rejection paths**

- Wrong DM password: browser keeps prompting (Basic Auth challenge loop). ✓
- Right DM password but tampered cookie (set in devtools): on next page load, `/api/me` returns `anon`, page falls back to name-picker.
- Manually delete the `vtt_player_id` cookie and reload: name-picker reappears.

- [ ] **Step 11: Tag the milestone**

```bash
git tag m2-auth
git push --tags
```

(Tagging is optional but useful — provides a clean rollback point.)

---

## M2 Completion Criteria

- All checkboxes above completed.
- `npm test` passes (every M2 test plus the existing M1 ones).
- `npm run typecheck` exits 0.
- `npm run build` produces `dist/server.js` and `public/`.
- DM and player end-to-end flows work in production with all three layers
  of auth in play (Caddy Basic Auth → signed cookie → Socket.IO middleware).
- The on-box `.env` and `vtt.sqlite` survive subsequent deploys.

After completion, **the M3 plan (Pages, Maps, Asset Upload)** can be drafted, building on the now-trusted `socket.data.role` / `socket.data.playerId`.

---

## Out of Scope Reminders (for the next plan)

These belong in M3 or later, not M2:

- Asset upload pipeline (sharp, dedup, WebP, thumbnails).
- Pages CRUD and the pages sidebar.
- Map library panel.
- "Set Active" page action and broadcast.
- Tokens, drag, snap-to-grid, ownership.
- Fog brush UI.
- Player list / online indicator.
- DM private-preview navigation.
- Reconnection `state:request_full_sync` round-trip (placeholder `session`
  event is fine for M2).

If a step in this M2 plan seems to drift toward any of these, stop and revisit — it doesn't belong here.
