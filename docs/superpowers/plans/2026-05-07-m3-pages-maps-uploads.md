# M3: Pages, Maps, Asset Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the asset-upload pipeline (maps), pages CRUD over HTTP, DM sidebar/library UI, and a player view that renders the active page background — so the DM can upload a map, create a page, set it active, and a player sees it.

**Architecture:** Asset upload + pages CRUD are HTTP REST under `/api/dm/*`, gated by Caddy `basic_auth` in prod and a route-level `requireDm` cookie guard in code. The image pipeline (sharp + sha256) is a pure module; the route handler orchestrates I/O. Server emits Socket.IO events on success: DM-only events (`asset:created`, `page:*`) go via a `dm` room joined at handshake; the active-page broadcast (`state:active_page_changed`) fans out to everyone. A new `state:full_sync` event is emitted on every connection with the current active page (extended in later milestones to include tokens / fog / players).

**Tech Stack additions:** `sharp` (image normalization), `multer` (multipart parsing), `file-type` (mime sniffing from bytes), `zustand` (client state). All standard, well-maintained.

**M3 Done When:**
- DM uploads a map via the library panel, the file lands in `UPLOADS_DIR/<hash>.webp`, and the asset shows up in the library list.
- Same upload twice → second returns the existing asset (dedup), no second file written.
- DM creates a page picking the uploaded map, sets it active. Player sees that map full-bleed (`<img>`, `object-fit: contain`).
- Page deletion is refused with 409 while the page is active.
- All existing tests pass; new tests cover pipeline, assets DB, pages DB, the routes, and `state:full_sync` / `state:active_page_changed` broadcasts.
- `npm run typecheck` clean, `npm test` green, `npm run build` succeeds.

**Reference:** `docs/superpowers/specs/2026-05-07-m3-design.md` is the design source of truth. Parent spec is `docs/superpowers/specs/2026-04-27-vtt-design.md` (note that §6 was patched in the same commit as the M3 spec to reflect the HTTP/socket split).

**Conventions** (same as M2):
- ESM everywhere; `.js` import suffixes on relative imports.
- TS strict; no `any`. Prefer narrow types and discriminated unions.
- Each task ends with one focused commit.
- Tests use in-memory SQLite (`:memory:`); UPLOADS_DIR for tests is a tmpdir set in `tests/setup.ts`.
- TDD where it helps (DB modules, pure functions, route happy/sad paths). UI components don't get unit tests.
- Imports stay sorted: external first, then internal alphabetical.

---

## File Structure

Files this milestone creates or modifies. Each path appears in exactly one task's "Create" or "Modify" line.

```
/                                            (project root)
├── package.json                              modified Task 1 (server deps), Task 12 (zustand)
├── package-lock.json                         modified by npm install in Tasks 1, 12
├── .env.example                              modified Task 1 (UPLOADS_DIR)
├── tests/
│   ├── setup.ts                              modified Task 1 (UPLOADS_DIR tmpdir)
│   ├── socket.test.ts                        modified Task 8 (state:full_sync assertion)
│   ├── storage.test.ts                       Task 2
│   ├── pipeline.test.ts                      Task 3
│   ├── assets.test.ts                        Task 4
│   ├── pages.test.ts                         Task 5
│   ├── dm-guard.test.ts                      Task 6
│   ├── broadcast.test.ts                     Task 7
│   ├── dm-assets.test.ts                     Task 9
│   └── dm-pages.test.ts                      Task 10
├── server/
│   └── src/
│       ├── server.ts                         modified Task 11 (mount routes, /assets static)
│       ├── socket.ts                         modified Task 8 (dm room, full_sync emit)
│       ├── assets/
│       │   ├── storage.ts                    Task 2
│       │   └── pipeline.ts                   Task 3
│       ├── auth/
│       │   └── dm-guard.ts                   Task 6
│       ├── broadcast.ts                      Task 7
│       ├── db/
│       │   ├── assets.ts                     Task 4
│       │   └── pages.ts                      Task 5
│       └── routes/
│           ├── dm-assets.ts                  Task 9
│           └── dm-pages.ts                   Task 10
├── client/
│   └── src/
│       ├── api.ts                            modified Task 13 (assets + pages wrappers)
│       ├── App.tsx                           (existing, unchanged)
│       ├── DmApp.tsx                         modified Task 14 (sidebar layout, listeners)
│       ├── PlayerApp.tsx                     modified Task 15 (active page render, listeners)
│       ├── stores/
│       │   ├── dmStore.ts                    Task 12
│       │   └── playerStore.ts                Task 12
│       ├── dm/
│       │   ├── PagesSidebar.tsx              Task 14
│       │   ├── MapsLibrary.tsx               Task 14
│       │   ├── NewPageModal.tsx              Task 14
│       │   └── DmCanvas.tsx                  Task 14
│       └── player/
│           └── PlayerCanvas.tsx              Task 15
└── infra/
    └── caddy/
        └── Caddyfile.vtt                    modified Task 16 (handle /assets/*)
```

**File responsibilities:**

- `server/src/assets/storage.ts` — pure-ish: `getUploadsDir()`, `ensureUploadsDir()`, `assetPath(hash)`, `thumbPath(hash)`, `atomicWrite(target, bytes)` (temp + rename), `totalUploadsBytes(dir)`, `MAX_UPLOADS_BYTES` constant. No DB, no HTTP.
- `server/src/assets/pipeline.ts` — pure: `processImage(buffer, kind)` returns `{ hash, processed, thumb, width, height, mime }`. Throws `PipelineError` with codes `UNSUPPORTED_MIME` or `OVERSIZE`. No filesystem, no DB.
- `server/src/db/assets.ts` — `findAssetByHash`, `findAssetById`, `insertAsset`, `listAssets(kind)`. Returns camelCase `Asset` objects.
- `server/src/db/pages.ts` — `listPages`, `findPageById`, `findActivePage`, `createPage`, `updatePage`, `deletePage`, `setActivePage`. Throws `PageError` with codes `NOT_FOUND`, `ACTIVE_DELETE`, `BAD_INPUT`.
- `server/src/auth/dm-guard.ts` — `requireDm` Express middleware: 401s if `vtt_dm` cookie isn't valid. Used on `/api/dm/assets/*` and `/api/dm/pages/*`. (`/api/dm/bootstrap` itself is unguarded — it sets the cookie.)
- `server/src/broadcast.ts` — `resolvePageWithUrl(db, page)` joins asset hash → URL; `buildFullSync(db)` returns `{ activePage }`; `broadcastActivePageChanged(io, page)` does `io.emit(...)`. Pure-ish helpers for shaping outbound events.
- `server/src/routes/dm-assets.ts` — `dmAssetsRouter({ db, io })`: `POST /upload` (multer), `GET /` (list). Applies `requireDm` at router level.
- `server/src/routes/dm-pages.ts` — `dmPagesRouter({ db, io })`: `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`, `PUT /:id/set-active`. Applies `requireDm`.
- `client/src/stores/dmStore.ts` — Zustand store for DM: `pages`, `assets`, `selectedPageId`, `activePageId` + actions to set them.
- `client/src/stores/playerStore.ts` — Zustand store for Player: `activePage` + setter.
- `client/src/dm/PagesSidebar.tsx` — list of pages, "Set Active" / delete buttons, "+ New page" trigger.
- `client/src/dm/MapsLibrary.tsx` — grid of map thumbnails + "+ Upload" file picker.
- `client/src/dm/NewPageModal.tsx` — form: name, map dropdown, grid size; submits POST.
- `client/src/dm/DmCanvas.tsx` — renders selected page's background image, full-bleed placeholder until M4.
- `client/src/player/PlayerCanvas.tsx` — renders active page's background image full-bleed; "Waiting for the DM…" if null.

---

## Task 1: Add server deps, env, and uploads tmpdir

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (regenerated)
- Modify: `.env.example`
- Modify: `tests/setup.ts`

- [ ] **Step 1: Add deps to `package.json`**

In the `dependencies` block, add (alphabetized):
```json
    "file-type": "^19.0.0",
    "multer": "^1.4.5-lts.1",
    "sharp": "^0.33.5",
```

In `devDependencies`, add:
```json
    "@types/multer": "^1.4.12",
```

The full `dependencies` should now be:
```json
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "cookie": "^0.7.0",
    "express": "^4.21.0",
    "file-type": "^19.0.0",
    "multer": "^1.4.5-lts.1",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "sharp": "^0.33.5",
    "socket.io": "^4.8.0",
    "socket.io-client": "^4.8.0"
  },
```

The full `devDependencies` should now be:
```json
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/cookie": "^0.6.0",
    "@types/express": "^4.17.0",
    "@types/multer": "^1.4.12",
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

- [ ] **Step 2: Append `UPLOADS_DIR` to `.env.example`**

Read the current `.env.example`, then append at the end:
```
# Where uploaded asset files (and thumbnails) live. Relative paths resolve from cwd.
# In prod, set to /home/ubuntu/services/vtt/uploads (matches Caddyfile root).
UPLOADS_DIR=uploads
```

- [ ] **Step 3: Update `tests/setup.ts` to mkdtemp an UPLOADS_DIR**

Replace the entire contents of `tests/setup.ts` with:
```ts
// Set required env vars before any module imports them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.APP_SECRET = 'test-secret-do-not-use-in-prod';
// Make sure COOKIE_SECURE doesn't leak in from the operator's shell — tests
// need to control it explicitly.
delete process.env.COOKIE_SECURE;

// Per-worker tmpdir for asset uploads. Vitest runs each test file in its own
// worker process, so this is isolated per-file.
const uploadsTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-uploads-'));
process.env.UPLOADS_DIR = uploadsTmp;
```

- [ ] **Step 4: Install deps**

Run: `npm install`

Expected: completes successfully. `sharp` may take a moment because it has prebuilt binaries to fetch. If it fails on a network blip, retry once.

- [ ] **Step 5: Confirm typecheck still passes**

Run: `npm run typecheck`

Expected: clean (no new code yet, just deps).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example tests/setup.ts
git commit -m "chore: add sharp/multer/file-type for M3 asset pipeline; tmpdir UPLOADS_DIR for tests"
```

---

## Task 2: Asset storage helpers (TDD)

**Files:**
- Create: `server/src/assets/storage.ts`
- Create: `tests/storage.test.ts`

- [ ] **Step 1: Write the failing test (`tests/storage.test.ts`)**

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  assetPath,
  atomicWrite,
  ensureUploadsDir,
  getUploadsDir,
  thumbPath,
  totalUploadsBytes,
} from '../server/src/assets/storage.js';

describe('storage helpers', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-storage-test-'));
    process.env.UPLOADS_DIR = dir;
  });

  it('getUploadsDir returns the env var', () => {
    expect(getUploadsDir()).toBe(dir);
  });

  it('ensureUploadsDir is idempotent', () => {
    ensureUploadsDir();
    ensureUploadsDir();
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('assetPath/thumbPath build hash-based filenames', () => {
    expect(assetPath('abc')).toBe(path.join(dir, 'abc.webp'));
    expect(thumbPath('abc')).toBe(path.join(dir, 'abc.thumb.webp'));
  });

  it('atomicWrite writes the file and leaves no .tmp behind', async () => {
    const target = assetPath('x');
    await atomicWrite(target, Buffer.from('hello'));
    expect(fs.readFileSync(target).toString()).toBe('hello');
    const leftover = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.tmp'));
    expect(leftover).toEqual([]);
  });

  it('totalUploadsBytes sums file sizes in the dir', async () => {
    await atomicWrite(assetPath('a'), Buffer.alloc(100));
    await atomicWrite(assetPath('b'), Buffer.alloc(250));
    expect(totalUploadsBytes()).toBe(350);
  });

  it('totalUploadsBytes returns 0 for a missing dir', () => {
    fs.rmSync(dir, { recursive: true });
    expect(totalUploadsBytes()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/storage.test.ts`
Expected: FAIL — module `../server/src/assets/storage.js` not found.

- [ ] **Step 3: Implement `server/src/assets/storage.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const MAX_UPLOADS_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB sanity ceiling

export function getUploadsDir(): string {
  return process.env.UPLOADS_DIR ?? path.resolve('uploads');
}

export function ensureUploadsDir(dir = getUploadsDir()): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function assetPath(hash: string, dir = getUploadsDir()): string {
  return path.join(dir, `${hash}.webp`);
}

export function thumbPath(hash: string, dir = getUploadsDir()): string {
  return path.join(dir, `${hash}.thumb.webp`);
}

export async function atomicWrite(targetPath: string, bytes: Buffer): Promise<void> {
  const tmp = `${targetPath}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.promises.writeFile(tmp, bytes);
  await fs.promises.rename(tmp, targetPath);
}

export function totalUploadsBytes(dir = getUploadsDir()): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      total += fs.statSync(path.join(dir, entry.name)).size;
    }
  }
  return total;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/storage.test.ts`
Expected: PASS (all 6 tests green).

- [ ] **Step 5: Commit**

```bash
git add server/src/assets/storage.ts tests/storage.test.ts
git commit -m "feat(server): asset storage helpers (paths, atomic write, disk usage)"
```

---

## Task 3: Image pipeline (TDD)

**Files:**
- Create: `server/src/assets/pipeline.ts`
- Create: `tests/pipeline.test.ts`

- [ ] **Step 1: Write the failing test (`tests/pipeline.test.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { PipelineError, processImage } from '../server/src/assets/pipeline.js';

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
}

describe('processImage (map kind)', () => {
  it('normalizes a small PNG into WebP and returns metadata', async () => {
    const png = await makePng(300, 200);
    const result = await processImage(png, 'map');
    expect(result.mime).toBe('image/webp');
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
    expect(result.processed.length).toBeGreaterThan(0);
    expect(result.thumb.length).toBeGreaterThan(0);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces an identical hash for identical input', async () => {
    const png = await makePng(64, 64);
    const a = await processImage(png, 'map');
    const b = await processImage(png, 'map');
    expect(a.hash).toBe(b.hash);
  });

  it('downscales maps larger than 4096px on the longest edge', async () => {
    const png = await makePng(6000, 3000);
    const result = await processImage(png, 'map');
    expect(result.width).toBe(4096);
    expect(result.height).toBe(2048);
  });

  it('rejects images whose input dimensions exceed 8192px', async () => {
    const png = await makePng(8200, 100);
    await expect(processImage(png, 'map')).rejects.toThrow(PipelineError);
  });

  it('rejects non-image bytes', async () => {
    const garbage = Buffer.from('not an image at all');
    await expect(processImage(garbage, 'map')).rejects.toThrow(PipelineError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/pipeline.test.ts`
Expected: FAIL — module `../server/src/assets/pipeline.js` not found.

- [ ] **Step 3: Implement `server/src/assets/pipeline.ts`**

```ts
import crypto from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

export const ALLOWED_MIMES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
export const MAX_INPUT_DIMENSION = 8192;
export const MAP_MAX_LONGEST_EDGE = 4096;
export const TOKEN_MAX_DIMENSION = 512;
export const THUMB_MAP = 256;
export const THUMB_TOKEN = 128;

export type AssetKind = 'map' | 'token';

export type PipelineErrorCode = 'UNSUPPORTED_MIME' | 'OVERSIZE';

export class PipelineError extends Error {
  constructor(
    public readonly code: PipelineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

export interface ProcessResult {
  hash: string;
  processed: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  mime: 'image/webp';
}

export async function processImage(buffer: Buffer, kind: AssetKind): Promise<ProcessResult> {
  const sniff = await fileTypeFromBuffer(buffer);
  if (!sniff || !ALLOWED_MIMES.has(sniff.mime)) {
    throw new PipelineError('UNSUPPORTED_MIME', `unsupported mime: ${sniff?.mime ?? 'unknown'}`);
  }

  const meta = await sharp(buffer).metadata();
  if (
    !meta.width ||
    !meta.height ||
    meta.width > MAX_INPUT_DIMENSION ||
    meta.height > MAX_INPUT_DIMENSION
  ) {
    throw new PipelineError('OVERSIZE', `input dimensions exceed ${MAX_INPUT_DIMENSION}px`);
  }

  const longest = kind === 'map' ? MAP_MAX_LONGEST_EDGE : TOKEN_MAX_DIMENSION;
  const thumbDim = kind === 'map' ? THUMB_MAP : THUMB_TOKEN;

  const processed = await sharp(buffer)
    .resize({ width: longest, height: longest, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();

  const processedMeta = await sharp(processed).metadata();
  if (!processedMeta.width || !processedMeta.height) {
    throw new PipelineError('UNSUPPORTED_MIME', 'failed to read processed dimensions');
  }

  const thumb = await sharp(buffer)
    .resize({ width: thumbDim, height: thumbDim, fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer();

  const hash = crypto.createHash('sha256').update(processed).digest('hex');

  return {
    hash,
    processed,
    thumb,
    width: processedMeta.width,
    height: processedMeta.height,
    mime: 'image/webp',
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/pipeline.test.ts`
Expected: PASS (all 5 tests green).

- [ ] **Step 5: Commit**

```bash
git add server/src/assets/pipeline.ts tests/pipeline.test.ts
git commit -m "feat(server): image pipeline (sharp resize, hash, thumbnail)"
```

---

## Task 4: Assets DB module (TDD)

**Files:**
- Create: `server/src/db/assets.ts`
- Create: `tests/assets.test.ts`

- [ ] **Step 1: Write the failing test (`tests/assets.test.ts`)**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/src/db/migrate.js';
import {
  findAssetByHash,
  findAssetById,
  insertAsset,
  listAssets,
} from '../server/src/db/assets.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, 'migrations');
  return db;
}

describe('assets db module', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('insertAsset returns a camelCase Asset', () => {
    const a = insertAsset(db, {
      hash: 'h1',
      kind: 'map',
      originalName: 'cave.png',
      mime: 'image/webp',
      width: 800,
      height: 600,
      sizeBytes: 12345,
    });
    expect(a.id).toBeGreaterThan(0);
    expect(a.hash).toBe('h1');
    expect(a.kind).toBe('map');
    expect(a.originalName).toBe('cave.png');
    expect(a.width).toBe(800);
    expect(a.height).toBe(600);
    expect(a.sizeBytes).toBe(12345);
    expect(a.uploadedAt).toBeGreaterThan(0);
  });

  it('findAssetByHash returns null on miss, the row on hit', () => {
    expect(findAssetByHash(db, 'nope')).toBeNull();
    insertAsset(db, {
      hash: 'h2',
      kind: 'map',
      originalName: 'x.png',
      mime: 'image/webp',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });
    const found = findAssetByHash(db, 'h2');
    expect(found?.hash).toBe('h2');
  });

  it('findAssetById round-trips', () => {
    const a = insertAsset(db, {
      hash: 'h3',
      kind: 'map',
      originalName: 'x.png',
      mime: 'image/webp',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });
    expect(findAssetById(db, a.id)?.id).toBe(a.id);
    expect(findAssetById(db, 999)).toBeNull();
  });

  it('listAssets filters by kind, newest first', async () => {
    const m1 = insertAsset(db, {
      hash: 'm1',
      kind: 'map',
      originalName: 'm1.png',
      mime: 'image/webp',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    const m2 = insertAsset(db, {
      hash: 'm2',
      kind: 'map',
      originalName: 'm2.png',
      mime: 'image/webp',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });
    insertAsset(db, {
      hash: 't1',
      kind: 'token',
      originalName: 't1.png',
      mime: 'image/webp',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });

    const maps = listAssets(db, 'map');
    expect(maps.map((a) => a.id)).toEqual([m2.id, m1.id]);
    const tokens = listAssets(db, 'token');
    expect(tokens.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/assets.test.ts`
Expected: FAIL — module `../server/src/db/assets.js` not found.

- [ ] **Step 3: Implement `server/src/db/assets.ts`**

```ts
import type Database from 'better-sqlite3';

export type AssetKind = 'map' | 'token';

export interface Asset {
  id: number;
  hash: string;
  kind: AssetKind;
  originalName: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
  uploadedAt: number;
}

interface AssetRow {
  id: number;
  hash: string;
  kind: AssetKind;
  original_name: string;
  mime: string;
  width: number;
  height: number;
  size_bytes: number;
  uploaded_at: number;
}

function rowToAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    hash: row.hash,
    kind: row.kind,
    originalName: row.original_name,
    mime: row.mime,
    width: row.width,
    height: row.height,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
  };
}

export interface InsertAssetFields {
  hash: string;
  kind: AssetKind;
  originalName: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export function insertAsset(db: Database.Database, fields: InsertAssetFields): Asset {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO assets (hash, kind, original_name, mime, width, height, size_bytes, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.hash,
      fields.kind,
      fields.originalName,
      fields.mime,
      fields.width,
      fields.height,
      fields.sizeBytes,
      now,
    );
  return {
    id: Number(info.lastInsertRowid),
    hash: fields.hash,
    kind: fields.kind,
    originalName: fields.originalName,
    mime: fields.mime,
    width: fields.width,
    height: fields.height,
    sizeBytes: fields.sizeBytes,
    uploadedAt: now,
  };
}

export function findAssetByHash(db: Database.Database, hash: string): Asset | null {
  const row = db.prepare('SELECT * FROM assets WHERE hash = ?').get(hash) as AssetRow | undefined;
  return row ? rowToAsset(row) : null;
}

export function findAssetById(db: Database.Database, id: number): Asset | null {
  const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined;
  return row ? rowToAsset(row) : null;
}

export function listAssets(db: Database.Database, kind: AssetKind): Asset[] {
  const rows = db
    .prepare('SELECT * FROM assets WHERE kind = ? ORDER BY uploaded_at DESC, id DESC')
    .all(kind) as AssetRow[];
  return rows.map(rowToAsset);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/assets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/assets.ts tests/assets.test.ts
git commit -m "feat(server): assets db module (insert, find, list)"
```

---

## Task 5: Pages DB module (TDD)

**Files:**
- Create: `server/src/db/pages.ts`
- Create: `tests/pages.test.ts`

- [ ] **Step 1: Write the failing test (`tests/pages.test.ts`)**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/src/db/migrate.js';
import { insertAsset } from '../server/src/db/assets.js';
import {
  PageError,
  createPage,
  deletePage,
  findActivePage,
  findPageById,
  listPages,
  setActivePage,
  updatePage,
} from '../server/src/db/pages.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, 'migrations');
  return db;
}

function seedAsset(db: Database.Database, hash = 'h'): number {
  return insertAsset(db, {
    hash,
    kind: 'map',
    originalName: 'm.png',
    mime: 'image/webp',
    width: 1,
    height: 1,
    sizeBytes: 1,
  }).id;
}

describe('pages db module', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('createPage assigns sort_order = (max + 1) and is_active = 0', () => {
    const a = seedAsset(db);
    const p1 = createPage(db, {
      name: 'A',
      backgroundAssetId: a,
      gridWidthSquares: 20,
      gridHeightSquares: 15,
    });
    const p2 = createPage(db, {
      name: 'B',
      backgroundAssetId: a,
      gridWidthSquares: 20,
      gridHeightSquares: 15,
    });
    expect(p1.sortOrder).toBe(0);
    expect(p2.sortOrder).toBe(1);
    expect(p1.isActive).toBe(0);
    expect(p2.isActive).toBe(0);
  });

  it('listPages returns sorted by sort_order ascending', () => {
    const a = seedAsset(db);
    const p1 = createPage(db, { name: 'A', backgroundAssetId: a, gridWidthSquares: 1, gridHeightSquares: 1 });
    const p2 = createPage(db, { name: 'B', backgroundAssetId: a, gridWidthSquares: 1, gridHeightSquares: 1 });
    expect(listPages(db).map((p) => p.id)).toEqual([p1.id, p2.id]);
  });

  it('findPageById returns null on miss', () => {
    expect(findPageById(db, 999)).toBeNull();
  });

  it('setActivePage is exclusive (only one is_active=1 ever)', () => {
    const a = seedAsset(db);
    const p1 = createPage(db, { name: 'A', backgroundAssetId: a, gridWidthSquares: 1, gridHeightSquares: 1 });
    const p2 = createPage(db, { name: 'B', backgroundAssetId: a, gridWidthSquares: 1, gridHeightSquares: 1 });
    setActivePage(db, p1.id);
    expect(findActivePage(db)?.id).toBe(p1.id);
    setActivePage(db, p2.id);
    expect(findActivePage(db)?.id).toBe(p2.id);
    const all = listPages(db);
    expect(all.filter((p) => p.isActive === 1)).toHaveLength(1);
  });

  it('setActivePage throws NOT_FOUND for unknown id', () => {
    expect(() => setActivePage(db, 999)).toThrowError(PageError);
  });

  it('updatePage updates only provided fields', () => {
    const a = seedAsset(db);
    const p = createPage(db, {
      name: 'A',
      backgroundAssetId: a,
      gridWidthSquares: 20,
      gridHeightSquares: 15,
    });
    const u = updatePage(db, p.id, { name: 'A renamed' });
    expect(u.name).toBe('A renamed');
    expect(u.gridWidthSquares).toBe(20);
  });

  it('updatePage throws NOT_FOUND for unknown id', () => {
    expect(() => updatePage(db, 999, { name: 'x' })).toThrowError(PageError);
  });

  it('deletePage refuses an active page (ACTIVE_DELETE)', () => {
    const a = seedAsset(db);
    const p = createPage(db, { name: 'A', backgroundAssetId: a, gridWidthSquares: 1, gridHeightSquares: 1 });
    setActivePage(db, p.id);
    expect(() => deletePage(db, p.id)).toThrowError(PageError);
  });

  it('deletePage removes a non-active page', () => {
    const a = seedAsset(db);
    const p = createPage(db, { name: 'A', backgroundAssetId: a, gridWidthSquares: 1, gridHeightSquares: 1 });
    deletePage(db, p.id);
    expect(findPageById(db, p.id)).toBeNull();
  });

  it('deletePage throws NOT_FOUND for unknown id', () => {
    expect(() => deletePage(db, 999)).toThrowError(PageError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/pages.test.ts`
Expected: FAIL — module `../server/src/db/pages.js` not found.

- [ ] **Step 3: Implement `server/src/db/pages.ts`**

```ts
import type Database from 'better-sqlite3';

export interface Page {
  id: number;
  name: string;
  backgroundAssetId: number | null;
  gridWidthSquares: number;
  gridHeightSquares: number;
  sortOrder: number;
  isActive: 0 | 1;
}

interface PageRow {
  id: number;
  name: string;
  background_asset_id: number | null;
  grid_width_squares: number;
  grid_height_squares: number;
  sort_order: number;
  is_active: 0 | 1;
}

function rowToPage(row: PageRow): Page {
  return {
    id: row.id,
    name: row.name,
    backgroundAssetId: row.background_asset_id,
    gridWidthSquares: row.grid_width_squares,
    gridHeightSquares: row.grid_height_squares,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

export type PageErrorCode = 'NOT_FOUND' | 'ACTIVE_DELETE';

export class PageError extends Error {
  constructor(
    public readonly code: PageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PageError';
  }
}

export interface CreatePageFields {
  name: string;
  backgroundAssetId: number | null;
  gridWidthSquares: number;
  gridHeightSquares: number;
}

export function listPages(db: Database.Database): Page[] {
  const rows = db
    .prepare('SELECT * FROM pages ORDER BY sort_order ASC, id ASC')
    .all() as PageRow[];
  return rows.map(rowToPage);
}

export function findPageById(db: Database.Database, id: number): Page | null {
  const row = db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as PageRow | undefined;
  return row ? rowToPage(row) : null;
}

export function findActivePage(db: Database.Database): Page | null {
  const row = db
    .prepare('SELECT * FROM pages WHERE is_active = 1 LIMIT 1')
    .get() as PageRow | undefined;
  return row ? rowToPage(row) : null;
}

export function createPage(db: Database.Database, fields: CreatePageFields): Page {
  const now = Date.now();
  const nextSort =
    (db.prepare('SELECT COALESCE(MAX(sort_order) + 1, 0) AS n FROM pages').get() as { n: number })
      .n;
  const info = db
    .prepare(
      `INSERT INTO pages (name, background_asset_id, grid_width_squares, grid_height_squares,
                          sort_order, is_active, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, '{}', ?, ?)`,
    )
    .run(
      fields.name,
      fields.backgroundAssetId,
      fields.gridWidthSquares,
      fields.gridHeightSquares,
      nextSort,
      now,
      now,
    );
  const id = Number(info.lastInsertRowid);
  return findPageById(db, id)!;
}

export interface UpdatePageFields {
  name?: string;
  backgroundAssetId?: number | null;
  gridWidthSquares?: number;
  gridHeightSquares?: number;
  sortOrder?: number;
}

export function updatePage(
  db: Database.Database,
  id: number,
  fields: UpdatePageFields,
): Page {
  const existing = findPageById(db, id);
  if (!existing) throw new PageError('NOT_FOUND', `page ${id} not found`);

  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (fields.name !== undefined) {
    sets.push('name = ?');
    values.push(fields.name);
  }
  if (fields.backgroundAssetId !== undefined) {
    sets.push('background_asset_id = ?');
    values.push(fields.backgroundAssetId);
  }
  if (fields.gridWidthSquares !== undefined) {
    sets.push('grid_width_squares = ?');
    values.push(fields.gridWidthSquares);
  }
  if (fields.gridHeightSquares !== undefined) {
    sets.push('grid_height_squares = ?');
    values.push(fields.gridHeightSquares);
  }
  if (fields.sortOrder !== undefined) {
    sets.push('sort_order = ?');
    values.push(fields.sortOrder);
  }
  if (sets.length === 0) return existing;

  sets.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  db.prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return findPageById(db, id)!;
}

export function deletePage(db: Database.Database, id: number): void {
  const existing = findPageById(db, id);
  if (!existing) throw new PageError('NOT_FOUND', `page ${id} not found`);
  if (existing.isActive === 1) {
    throw new PageError('ACTIVE_DELETE', 'cannot delete the active page; set another active first');
  }
  db.prepare('DELETE FROM pages WHERE id = ?').run(id);
}

export function setActivePage(db: Database.Database, id: number): Page {
  const tx = db.transaction((targetId: number) => {
    const existing = findPageById(db, targetId);
    if (!existing) throw new PageError('NOT_FOUND', `page ${targetId} not found`);
    db.prepare('UPDATE pages SET is_active = 0, updated_at = ? WHERE is_active = 1').run(Date.now());
    db.prepare('UPDATE pages SET is_active = 1, updated_at = ? WHERE id = ?').run(
      Date.now(),
      targetId,
    );
  });
  tx(id);
  return findPageById(db, id)!;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/pages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/pages.ts tests/pages.test.ts
git commit -m "feat(server): pages db module (CRUD + exclusive setActive TX)"
```

---

## Task 6: DM cookie guard middleware (TDD)

**Files:**
- Create: `server/src/auth/dm-guard.ts`
- Create: `tests/dm-guard.test.ts`

- [ ] **Step 1: Write the failing test (`tests/dm-guard.test.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { signCookie } from '../server/src/auth/cookies.js';
import { COOKIE_DM, COOKIE_PLAYER } from '../server/src/auth/constants.js';
import { requireDm } from '../server/src/auth/dm-guard.js';

function makeApp() {
  const app = express();
  app.use(requireDm);
  app.get('/', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('requireDm middleware', () => {
  it('rejects requests without a vtt_dm cookie', async () => {
    const res = await request(makeApp()).get('/');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/dm/i);
  });

  it('rejects requests with only a player cookie', async () => {
    const cookie = `${COOKIE_PLAYER}=${signCookie('1')}`;
    const res = await request(makeApp()).get('/').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('rejects a tampered DM cookie', async () => {
    const cookie = `${COOKIE_DM}=1.deadbeef`;
    const res = await request(makeApp()).get('/').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('allows requests with a valid DM cookie', async () => {
    const cookie = `${COOKIE_DM}=${signCookie('1')}`;
    const res = await request(makeApp()).get('/').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/dm-guard.test.ts`
Expected: FAIL — module `../server/src/auth/dm-guard.js` not found.

- [ ] **Step 3: Implement `server/src/auth/dm-guard.ts`**

```ts
import type { RequestHandler } from 'express';
import { COOKIE_DM } from './constants.js';
import { readSignedCookie } from './express-cookies.js';

export const requireDm: RequestHandler = (req, res, next) => {
  if (readSignedCookie(req, COOKIE_DM) === '1') {
    next();
    return;
  }
  res.status(401).json({ error: 'dm authentication required' });
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/dm-guard.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/dm-guard.ts tests/dm-guard.test.ts
git commit -m "feat(server): requireDm middleware for /api/dm/* defense-in-depth"
```

---

## Task 7: Broadcast helper module (TDD)

**Files:**
- Create: `server/src/broadcast.ts`
- Create: `tests/broadcast.test.ts`

- [ ] **Step 1: Write the failing test (`tests/broadcast.test.ts`)**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/src/db/migrate.js';
import { insertAsset } from '../server/src/db/assets.js';
import { createPage, setActivePage } from '../server/src/db/pages.js';
import { buildFullSync, resolvePageWithUrl } from '../server/src/broadcast.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, 'migrations');
  return db;
}

describe('broadcast helpers', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('resolvePageWithUrl returns null background_url when asset is missing', () => {
    const page = createPage(db, {
      name: 'A',
      backgroundAssetId: null,
      gridWidthSquares: 20,
      gridHeightSquares: 15,
    });
    const resolved = resolvePageWithUrl(db, page);
    expect(resolved.background_url).toBeNull();
    expect(resolved.background_asset_id).toBeNull();
    expect(resolved.id).toBe(page.id);
  });

  it('resolvePageWithUrl builds /assets/<hash>.webp when present', () => {
    const a = insertAsset(db, {
      hash: 'abc123',
      kind: 'map',
      originalName: 'm.png',
      mime: 'image/webp',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });
    const page = createPage(db, {
      name: 'A',
      backgroundAssetId: a.id,
      gridWidthSquares: 20,
      gridHeightSquares: 15,
    });
    const resolved = resolvePageWithUrl(db, page);
    expect(resolved.background_url).toBe('/assets/abc123.webp');
  });

  it('buildFullSync returns { activePage: null } when nothing is active', () => {
    expect(buildFullSync(db)).toEqual({ activePage: null });
  });

  it('buildFullSync returns the resolved active page when one exists', () => {
    const a = insertAsset(db, {
      hash: 'h',
      kind: 'map',
      originalName: 'm.png',
      mime: 'image/webp',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });
    const p = createPage(db, {
      name: 'A',
      backgroundAssetId: a.id,
      gridWidthSquares: 20,
      gridHeightSquares: 15,
    });
    setActivePage(db, p.id);
    const sync = buildFullSync(db);
    expect(sync.activePage?.id).toBe(p.id);
    expect(sync.activePage?.background_url).toBe('/assets/h.webp');
    expect(sync.activePage?.is_active).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/broadcast.test.ts`
Expected: FAIL — module `../server/src/broadcast.js` not found.

- [ ] **Step 3: Implement `server/src/broadcast.ts`**

```ts
import type Database from 'better-sqlite3';
import { findAssetById } from './db/assets.js';
import { findActivePage, type Page } from './db/pages.js';
import type { AppSocketIOServer } from './socket.js';

export interface PagePayload {
  id: number;
  name: string;
  background_asset_id: number | null;
  background_url: string | null;
  grid_width_squares: number;
  grid_height_squares: number;
  sort_order: number;
  is_active: 0 | 1;
}

export interface FullSyncPayload {
  activePage: PagePayload | null;
}

export function resolvePageWithUrl(db: Database.Database, page: Page): PagePayload {
  let url: string | null = null;
  if (page.backgroundAssetId !== null) {
    const asset = findAssetById(db, page.backgroundAssetId);
    if (asset) url = `/assets/${asset.hash}.webp`;
  }
  return {
    id: page.id,
    name: page.name,
    background_asset_id: page.backgroundAssetId,
    background_url: url,
    grid_width_squares: page.gridWidthSquares,
    grid_height_squares: page.gridHeightSquares,
    sort_order: page.sortOrder,
    is_active: page.isActive,
  };
}

export function buildFullSync(db: Database.Database): FullSyncPayload {
  const active = findActivePage(db);
  return { activePage: active ? resolvePageWithUrl(db, active) : null };
}

export function broadcastActivePageChanged(
  io: AppSocketIOServer,
  page: PagePayload | null,
): void {
  io.emit('state:active_page_changed', { activePage: page });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/broadcast.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/broadcast.ts tests/broadcast.test.ts
git commit -m "feat(server): broadcast helpers (resolvePageWithUrl, buildFullSync)"
```

---

## Task 8: Socket changes — DM room + state:full_sync emission

**Files:**
- Modify: `server/src/socket.ts`
- Modify: `tests/socket.test.ts`

- [ ] **Step 1: Modify `server/src/socket.ts`**

Replace the `io.on('connection', ...)` block with one that joins DM sockets to a `dm` room and emits `state:full_sync`. Add an import for `buildFullSync`.

Find this block:
```ts
import * as cookie from 'cookie';
import type Database from 'better-sqlite3';
import { verifyCookie } from './auth/cookies.js';
import { COOKIE_DM, COOKIE_PLAYER } from './auth/constants.js';
import { findPlayerById } from './db/players.js';
```

Add one import line after it:
```ts
import { buildFullSync } from './broadcast.js';
```

Find:
```ts
  io.on('connection', (socket) => {
    socket.emit('session', socket.data);
  });
```

Replace with:
```ts
  io.on('connection', (socket) => {
    if (socket.data.role === 'dm') socket.join('dm');
    socket.emit('session', socket.data);
    socket.emit('state:full_sync', buildFullSync(deps.db));
  });
```

- [ ] **Step 2: Add a test for `state:full_sync` to `tests/socket.test.ts`**

At the top of the file, add this import (alongside the other helpers):
```ts
import { insertAsset } from '../server/src/db/assets.js';
import { createPage, setActivePage } from '../server/src/db/pages.js';
```

Add a helper that registers an event listener BEFORE the socket connects (so the server's connection-time emit isn't lost):
```ts
function connectAndCapture<T>(
  url: string,
  cookie: string,
  event: string,
  timeoutMs = 2000,
): Promise<{ client: ClientSocket; payload: T }> {
  return new Promise((resolve, reject) => {
    const client = ioc(url, {
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
    });
    const t = setTimeout(() => {
      client.close();
      reject(new Error(`timed out before ${event}`));
    }, timeoutMs);
    client.once(event, (payload: T) => {
      clearTimeout(t);
      resolve({ client, payload });
    });
    client.on('connect_error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}
```

Add a new `describe` block at the end of the file:
```ts
describe('state:full_sync on connection', () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startTestServer();
  });

  afterAll(async () => {
    await ts.close();
  });

  it('emits { activePage: null } when no page is active', async () => {
    const cookie = await bootstrapDm(ts);
    const { client, payload } = await connectAndCapture<{ activePage: unknown }>(
      ts.url,
      cookie,
      'state:full_sync',
    );
    expect(payload.activePage).toBeNull();
    client.close();
  });

  it('emits the active page (with resolved background_url) when one exists', async () => {
    const a = insertAsset(ts.db, {
      hash: 'syncfix',
      kind: 'map',
      originalName: 'm.png',
      mime: 'image/webp',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });
    const p = createPage(ts.db, {
      name: 'Active',
      backgroundAssetId: a.id,
      gridWidthSquares: 20,
      gridHeightSquares: 15,
    });
    setActivePage(ts.db, p.id);

    const cookie = await bootstrapDm(ts);
    const { client, payload } = await connectAndCapture<{
      activePage: { id: number; background_url: string } | null;
    }>(ts.url, cookie, 'state:full_sync');
    expect(payload.activePage?.id).toBe(p.id);
    expect(payload.activePage?.background_url).toBe('/assets/syncfix.webp');
    client.close();
  });
});
```

- [ ] **Step 3: Run the socket test file**

Run: `npm test -- tests/socket.test.ts`

Expected: PASS — pre-existing tests still green; new `state:full_sync` block green.

If a pre-existing test now fails because it called `connect()` and the server emits `state:full_sync` to it, that's fine — `connect()` only awaits `connect`, ignoring extra events.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add server/src/socket.ts tests/socket.test.ts
git commit -m "feat(server): DM joins 'dm' room on connect; emit state:full_sync"
```

---

## Task 9: DM assets routes (upload + list, with integration tests)

**Files:**
- Create: `server/src/routes/dm-assets.ts`
- Create: `tests/dm-assets.test.ts`

- [ ] **Step 1: Write the failing test (`tests/dm-assets.test.ts`)**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { startTestServer, type TestServer } from './helpers/testServer.js';

async function makePng(width: number, height: number, color = '#ff0000'): Promise<Buffer> {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return sharp({
    create: { width, height, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
}

async function bootstrapDmCookie(ts: TestServer): Promise<string> {
  const res = await request(ts.server).get('/api/dm/bootstrap');
  const setCookie = res.headers['set-cookie'];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie!];
  return arr.map((c: string) => c.split(';')[0]).join('; ');
}

describe('POST /api/dm/assets/upload', () => {
  let ts: TestServer;
  let dmCookie: string;

  beforeEach(async () => {
    ts = await startTestServer();
    dmCookie = await bootstrapDmCookie(ts);
    // Clean upload dir between tests so dedup behavior is testable.
    const dir = process.env.UPLOADS_DIR!;
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
  });

  afterEach(async () => {
    await ts.close();
  });

  it('rejects requests without DM auth', async () => {
    const png = await makePng(50, 50);
    const res = await request(ts.server)
      .post('/api/dm/assets/upload')
      .attach('file', png, 'red.png')
      .field('kind', 'map');
    expect(res.status).toBe(401);
  });

  it('uploads a PNG, writes the file to UPLOADS_DIR, returns 201', async () => {
    const png = await makePng(50, 50);
    const res = await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .attach('file', png, 'red.png')
      .field('kind', 'map');
    expect(res.status).toBe(201);
    expect(res.body.asset.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.asset.kind).toBe('map');
    expect(res.body.asset.originalName).toBe('red.png');
    const stored = path.join(process.env.UPLOADS_DIR!, `${res.body.asset.hash}.webp`);
    expect(fs.existsSync(stored)).toBe(true);
  });

  it('dedupes identical re-uploads (200, no second file)', async () => {
    const png = await makePng(50, 50);
    const first = await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .attach('file', png, 'a.png')
      .field('kind', 'map');
    expect(first.status).toBe(201);

    const beforeFiles = fs.readdirSync(process.env.UPLOADS_DIR!).length;

    const second = await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .attach('file', png, 'a-copy.png')
      .field('kind', 'map');
    expect(second.status).toBe(200);
    expect(second.body.asset.id).toBe(first.body.asset.id);

    const afterFiles = fs.readdirSync(process.env.UPLOADS_DIR!).length;
    expect(afterFiles).toBe(beforeFiles);
  });

  it('rejects non-image bytes with 400', async () => {
    const garbage = Buffer.from('not an image');
    const res = await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .attach('file', garbage, 'fake.png')
      .field('kind', 'map');
    expect(res.status).toBe(400);
  });

  it('rejects oversized request bodies with 413', async () => {
    const huge = Buffer.alloc(6 * 1024 * 1024); // 6 MB
    const res = await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .attach('file', huge, 'big.bin')
      .field('kind', 'map');
    expect(res.status).toBe(413);
  });

  it('rejects requests missing the file field with 400', async () => {
    const res = await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .field('kind', 'map');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/dm/assets', () => {
  let ts: TestServer;
  let dmCookie: string;

  beforeEach(async () => {
    ts = await startTestServer();
    dmCookie = await bootstrapDmCookie(ts);
  });

  afterEach(async () => {
    await ts.close();
  });

  it('rejects without DM auth', async () => {
    const res = await request(ts.server).get('/api/dm/assets?kind=map');
    expect(res.status).toBe(401);
  });

  it('lists uploaded maps newest first', async () => {
    const a = await makePng(40, 40, '#ff0000');
    const b = await makePng(40, 40, '#00ff00');
    await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .attach('file', a, 'a.png')
      .field('kind', 'map');
    await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .attach('file', b, 'b.png')
      .field('kind', 'map');

    const res = await request(ts.server)
      .get('/api/dm/assets?kind=map')
      .set('Cookie', dmCookie);
    expect(res.status).toBe(200);
    expect(res.body.assets.length).toBe(2);
    expect(res.body.assets[0].originalName).toBe('b.png');
    expect(res.body.assets[1].originalName).toBe('a.png');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/dm-assets.test.ts`
Expected: FAIL — at minimum because `dm-assets.ts` is not implemented and `server.ts` doesn't mount the route. You'll get 404s on every request. That's the correct failure mode.

- [ ] **Step 3: Implement `server/src/routes/dm-assets.ts`**

```ts
import { Router, type ErrorRequestHandler } from 'express';
import multer, { MulterError } from 'multer';
import type Database from 'better-sqlite3';
import { requireDm } from '../auth/dm-guard.js';
import { PipelineError, processImage } from '../assets/pipeline.js';
import {
  MAX_UPLOADS_BYTES,
  assetPath,
  atomicWrite,
  ensureUploadsDir,
  thumbPath,
  totalUploadsBytes,
} from '../assets/storage.js';
import {
  findAssetByHash,
  insertAsset,
  listAssets,
  type AssetKind,
} from '../db/assets.js';
import type { AppSocketIOServer } from '../socket.js';

export interface DmAssetsDeps {
  db: Database.Database;
  io: AppSocketIOServer;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const multerErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'file too large (max 5 MB)' });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
};

export function dmAssetsRouter(deps: DmAssetsDeps): Router {
  const router = Router();
  router.use(requireDm);

  router.get('/', (req, res) => {
    const raw = req.query.kind;
    const kind: AssetKind = raw === 'token' ? 'token' : 'map';
    res.json({ assets: listAssets(deps.db, kind) });
  });

  router.post(
    '/upload',
    upload.single('file'),
    async (req, res, next) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'file field required' });
          return;
        }
        const kind: AssetKind = req.body.kind === 'token' ? 'token' : 'map';
        if (kind !== 'map') {
          res.status(400).json({ error: 'only map uploads supported in M3' });
          return;
        }

        if (totalUploadsBytes() > MAX_UPLOADS_BYTES) {
          res.status(507).json({ error: 'disk quota exceeded' });
          return;
        }

        let result;
        try {
          result = await processImage(req.file.buffer, kind);
        } catch (err) {
          if (err instanceof PipelineError) {
            res.status(400).json({ error: err.message, code: err.code });
            return;
          }
          throw err;
        }

        const existing = findAssetByHash(deps.db, result.hash);
        if (existing) {
          res.status(200).json({ asset: existing });
          return;
        }

        ensureUploadsDir();
        await atomicWrite(assetPath(result.hash), result.processed);
        await atomicWrite(thumbPath(result.hash), result.thumb);

        const asset = insertAsset(deps.db, {
          hash: result.hash,
          kind,
          originalName: req.file.originalname,
          mime: result.mime,
          width: result.width,
          height: result.height,
          sizeBytes: result.processed.length,
        });

        deps.io.to('dm').emit('asset:created', { asset });

        res.status(201).json({ asset });
      } catch (err) {
        next(err);
      }
    },
  );

  router.use(multerErrorHandler);

  return router;
}
```

- [ ] **Step 4: Mount the router temporarily for the test to pass**

Edit `server/src/server.ts`. Add an import:
```ts
import { dmAssetsRouter } from './routes/dm-assets.js';
```

Find this line:
```ts
  attachSocketIO(httpServer, deps);
```

Replace with:
```ts
  const io = attachSocketIO(httpServer, deps);
  app.use('/api/dm/assets', dmAssetsRouter({ db: deps.db, io }));
```

(Task 11 will reorganize this further; for now this is the minimum to pass the assets test.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/dm-assets.test.ts`
Expected: PASS (all upload + list cases).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/dm-assets.ts server/src/server.ts tests/dm-assets.test.ts
git commit -m "feat(server): POST /api/dm/assets/upload + GET /api/dm/assets"
```

---

## Task 10: DM pages routes (CRUD + set-active, with integration tests)

**Files:**
- Create: `server/src/routes/dm-pages.ts`
- Create: `tests/dm-pages.test.ts`
- Modify: `server/src/server.ts`

- [ ] **Step 1: Write the failing test (`tests/dm-pages.test.ts`)**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { startTestServer, type TestServer } from './helpers/testServer.js';

async function makePng(): Promise<Buffer> {
  return sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .png()
    .toBuffer();
}

async function bootstrapDmCookie(ts: TestServer): Promise<string> {
  const res = await request(ts.server).get('/api/dm/bootstrap');
  const arr = res.headers['set-cookie'] as unknown as string[];
  return arr.map((c) => c.split(';')[0]).join('; ');
}

async function uploadMap(ts: TestServer, cookie: string): Promise<number> {
  const png = await makePng();
  const res = await request(ts.server)
    .post('/api/dm/assets/upload')
    .set('Cookie', cookie)
    .attach('file', png, 'm.png')
    .field('kind', 'map');
  return res.body.asset.id;
}

describe('DM pages routes', () => {
  let ts: TestServer;
  let dm: string;

  beforeEach(async () => {
    ts = await startTestServer();
    dm = await bootstrapDmCookie(ts);
  });

  afterEach(async () => {
    await ts.close();
  });

  it('rejects all routes without DM auth', async () => {
    const r1 = await request(ts.server).get('/api/dm/pages');
    expect(r1.status).toBe(401);
    const r2 = await request(ts.server).post('/api/dm/pages').send({});
    expect(r2.status).toBe(401);
  });

  it('POST creates a page with sort_order=0, is_active=0', async () => {
    const assetId = await uploadMap(ts, dm);
    const res = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({
        name: 'Caves',
        background_asset_id: assetId,
        grid_width_squares: 30,
        grid_height_squares: 20,
      });
    expect(res.status).toBe(201);
    expect(res.body.page.name).toBe('Caves');
    expect(res.body.page.sort_order).toBe(0);
    expect(res.body.page.is_active).toBe(0);
    expect(res.body.page.background_url).toMatch(/^\/assets\/[0-9a-f]{64}\.webp$/);
  });

  it('POST rejects bad input with 400', async () => {
    const res = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ grid_width_squares: 20, grid_height_squares: 15 }); // missing name
    expect(res.status).toBe(400);
  });

  it('POST rejects unknown background_asset_id with 400', async () => {
    const res = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({
        name: 'A',
        background_asset_id: 9999,
        grid_width_squares: 20,
        grid_height_squares: 15,
      });
    expect(res.status).toBe(400);
  });

  it('GET lists pages sorted by sort_order with resolved background_url', async () => {
    const assetId = await uploadMap(ts, dm);
    await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'A', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });
    await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'B', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });

    const res = await request(ts.server).get('/api/dm/pages').set('Cookie', dm);
    expect(res.status).toBe(200);
    expect(res.body.pages.length).toBe(2);
    expect(res.body.pages[0].name).toBe('A');
    expect(res.body.pages[1].name).toBe('B');
    expect(res.body.pages[0].background_url).toMatch(/\.webp$/);
  });

  it('PATCH updates a page', async () => {
    const assetId = await uploadMap(ts, dm);
    const created = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'A', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });
    const id = created.body.page.id;

    const res = await request(ts.server)
      .patch(`/api/dm/pages/${id}`)
      .set('Cookie', dm)
      .send({ name: 'A renamed' });
    expect(res.status).toBe(200);
    expect(res.body.page.name).toBe('A renamed');
  });

  it('PATCH 404 on unknown id', async () => {
    const res = await request(ts.server)
      .patch('/api/dm/pages/9999')
      .set('Cookie', dm)
      .send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  it('PUT set-active makes exactly one page active', async () => {
    const assetId = await uploadMap(ts, dm);
    const r1 = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'A', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });
    const r2 = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'B', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });

    await request(ts.server)
      .put(`/api/dm/pages/${r1.body.page.id}/set-active`)
      .set('Cookie', dm);
    await request(ts.server)
      .put(`/api/dm/pages/${r2.body.page.id}/set-active`)
      .set('Cookie', dm);

    const list = await request(ts.server).get('/api/dm/pages').set('Cookie', dm);
    const active = list.body.pages.filter((p: { is_active: number }) => p.is_active === 1);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(r2.body.page.id);
  });

  it('DELETE 409 when active', async () => {
    const assetId = await uploadMap(ts, dm);
    const r = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'A', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });
    await request(ts.server).put(`/api/dm/pages/${r.body.page.id}/set-active`).set('Cookie', dm);

    const del = await request(ts.server)
      .delete(`/api/dm/pages/${r.body.page.id}`)
      .set('Cookie', dm);
    expect(del.status).toBe(409);
  });

  it('DELETE 204 on a non-active page', async () => {
    const assetId = await uploadMap(ts, dm);
    const r = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'A', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });

    const del = await request(ts.server)
      .delete(`/api/dm/pages/${r.body.page.id}`)
      .set('Cookie', dm);
    expect(del.status).toBe(204);
  });

  it('set-active broadcasts state:active_page_changed to all sockets', async () => {
    const { io } = await import('socket.io-client');
    const assetId = await uploadMap(ts, dm);
    const r = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'A', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });

    const client = io(ts.url, {
      transports: ['websocket'],
      extraHeaders: { Cookie: dm },
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('connect timeout')), 2000);
      client.on('connect', () => {
        clearTimeout(t);
        resolve();
      });
    });

    const eventPromise = new Promise<{ activePage: { id: number } | null }>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('event timeout')), 2000);
      client.once('state:active_page_changed', (payload) => {
        clearTimeout(t);
        resolve(payload);
      });
    });

    await request(ts.server).put(`/api/dm/pages/${r.body.page.id}/set-active`).set('Cookie', dm);

    const event = await eventPromise;
    expect(event.activePage?.id).toBe(r.body.page.id);
    client.close();
  });
});
```

- [ ] **Step 2: Implement `server/src/routes/dm-pages.ts`**

```ts
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { requireDm } from '../auth/dm-guard.js';
import { broadcastActivePageChanged, resolvePageWithUrl } from '../broadcast.js';
import { findAssetById } from '../db/assets.js';
import {
  PageError,
  createPage,
  deletePage,
  listPages,
  setActivePage,
  updatePage,
} from '../db/pages.js';
import type { AppSocketIOServer } from '../socket.js';

export interface DmPagesDeps {
  db: Database.Database;
  io: AppSocketIOServer;
}

interface CreateBody {
  name?: unknown;
  background_asset_id?: unknown;
  grid_width_squares?: unknown;
  grid_height_squares?: unknown;
}

function validateCreate(body: CreateBody, db: Database.Database): string | null {
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return 'name required';
  }
  if (!Number.isInteger(body.grid_width_squares) || (body.grid_width_squares as number) < 1) {
    return 'grid_width_squares must be a positive integer';
  }
  if (!Number.isInteger(body.grid_height_squares) || (body.grid_height_squares as number) < 1) {
    return 'grid_height_squares must be a positive integer';
  }
  if (body.background_asset_id !== null && body.background_asset_id !== undefined) {
    if (!Number.isInteger(body.background_asset_id)) {
      return 'background_asset_id must be an integer or null';
    }
    const asset = findAssetById(db, body.background_asset_id as number);
    if (!asset || asset.kind !== 'map') {
      return 'unknown background_asset_id';
    }
  }
  return null;
}

interface PatchBody {
  name?: unknown;
  background_asset_id?: unknown;
  grid_width_squares?: unknown;
  grid_height_squares?: unknown;
  sort_order?: unknown;
}

function buildPatchFields(
  body: PatchBody,
  db: Database.Database,
): { ok: true; fields: Parameters<typeof updatePage>[2] } | { ok: false; error: string } {
  const fields: Parameters<typeof updatePage>[2] = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return { ok: false, error: 'name must be a non-empty string' };
    }
    fields.name = body.name;
  }
  if (body.background_asset_id !== undefined) {
    if (body.background_asset_id !== null) {
      if (!Number.isInteger(body.background_asset_id)) {
        return { ok: false, error: 'background_asset_id must be integer or null' };
      }
      const a = findAssetById(db, body.background_asset_id as number);
      if (!a || a.kind !== 'map') return { ok: false, error: 'unknown background_asset_id' };
    }
    fields.backgroundAssetId = body.background_asset_id as number | null;
  }
  if (body.grid_width_squares !== undefined) {
    if (!Number.isInteger(body.grid_width_squares) || (body.grid_width_squares as number) < 1) {
      return { ok: false, error: 'grid_width_squares must be a positive integer' };
    }
    fields.gridWidthSquares = body.grid_width_squares as number;
  }
  if (body.grid_height_squares !== undefined) {
    if (!Number.isInteger(body.grid_height_squares) || (body.grid_height_squares as number) < 1) {
      return { ok: false, error: 'grid_height_squares must be a positive integer' };
    }
    fields.gridHeightSquares = body.grid_height_squares as number;
  }
  if (body.sort_order !== undefined) {
    if (!Number.isInteger(body.sort_order)) {
      return { ok: false, error: 'sort_order must be an integer' };
    }
    fields.sortOrder = body.sort_order as number;
  }
  return { ok: true, fields };
}

export function dmPagesRouter(deps: DmPagesDeps): Router {
  const router = Router();
  router.use(requireDm);

  router.get('/', (_req, res) => {
    const list = listPages(deps.db).map((p) => resolvePageWithUrl(deps.db, p));
    res.json({ pages: list });
  });

  router.post('/', (req, res) => {
    const body: CreateBody = req.body ?? {};
    const err = validateCreate(body, deps.db);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
    const page = createPage(deps.db, {
      name: (body.name as string).trim(),
      backgroundAssetId: (body.background_asset_id as number | null | undefined) ?? null,
      gridWidthSquares: body.grid_width_squares as number,
      gridHeightSquares: body.grid_height_squares as number,
    });
    const resolved = resolvePageWithUrl(deps.db, page);
    deps.io.to('dm').emit('page:created', { page: resolved });
    res.status(201).json({ page: resolved });
  });

  router.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const built = buildPatchFields(req.body ?? {}, deps.db);
    if (!built.ok) {
      res.status(400).json({ error: built.error });
      return;
    }
    try {
      const updated = updatePage(deps.db, id, built.fields);
      const resolved = resolvePageWithUrl(deps.db, updated);
      deps.io.to('dm').emit('page:updated', { page: resolved });
      res.json({ page: resolved });
    } catch (err) {
      if (err instanceof PageError && err.code === 'NOT_FOUND') {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    try {
      deletePage(deps.db, id);
      deps.io.to('dm').emit('page:deleted', { id });
      res.status(204).end();
    } catch (err) {
      if (err instanceof PageError) {
        if (err.code === 'NOT_FOUND') {
          res.status(404).json({ error: err.message });
          return;
        }
        if (err.code === 'ACTIVE_DELETE') {
          res.status(409).json({ error: err.message });
          return;
        }
      }
      throw err;
    }
  });

  router.put('/:id/set-active', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    try {
      const page = setActivePage(deps.db, id);
      const resolved = resolvePageWithUrl(deps.db, page);
      broadcastActivePageChanged(deps.io, resolved);
      res.json({ page: resolved });
    } catch (err) {
      if (err instanceof PageError && err.code === 'NOT_FOUND') {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}
```

- [ ] **Step 3: Mount the pages router in `server/src/server.ts`**

Add an import at the top:
```ts
import { dmPagesRouter } from './routes/dm-pages.js';
```

Below the `dmAssetsRouter` mount line added in Task 9, add:
```ts
  app.use('/api/dm/pages', dmPagesRouter({ db: deps.db, io }));
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/dm-pages.test.ts`
Expected: PASS (all 11 cases including the broadcast assertion).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/dm-pages.ts server/src/server.ts tests/dm-pages.test.ts
git commit -m "feat(server): pages CRUD + set-active over /api/dm/pages, with broadcast"
```

---

## Task 11: Wire `server.ts` for static asset serving + cleanup

**Files:**
- Modify: `server/src/server.ts`

The previous tasks bolted the new routers on. This task tidies the order and adds dev-mode `/assets/*` static serving.

- [ ] **Step 1: Replace `server/src/server.ts` with the cleaned-up version**

```ts
import express from 'express';
import http from 'node:http';
import type Database from 'better-sqlite3';
import healthRouter from './routes/health.js';
import { dmRouter } from './routes/dm.js';
import { dmAssetsRouter } from './routes/dm-assets.js';
import { dmPagesRouter } from './routes/dm-pages.js';
import { playerRouter } from './routes/player.js';
import { attachSocketIO } from './socket.js';
import { ensureUploadsDir, getUploadsDir } from './assets/storage.js';

export interface ServerDeps {
  db: Database.Database;
}

export function createServer(deps: ServerDeps): http.Server {
  const app = express();

  ensureUploadsDir();

  app.use(express.json());

  // Static asset serving. In production, Caddy's `handle /assets/*` matches
  // first and serves directly from disk; in dev (no Caddy) Express serves
  // the same files. Either way the URL shape is /assets/<hash>.webp.
  app.use(
    '/assets',
    express.static(getUploadsDir(), {
      immutable: true,
      maxAge: '1y',
    }),
  );

  app.use('/api/health', healthRouter);
  app.use('/api/dm', dmRouter());

  const httpServer = http.createServer(app);
  const io = attachSocketIO(httpServer, deps);

  app.use('/api/dm/assets', dmAssetsRouter({ db: deps.db, io }));
  app.use('/api/dm/pages', dmPagesRouter({ db: deps.db, io }));
  app.use('/api', playerRouter(deps.db));

  return httpServer;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 4: Run the production build to make sure esbuild + vite are happy**

Run: `npm run build`
Expected: succeeds; `dist/server.js` and `public/` produced.

- [ ] **Step 5: Commit**

```bash
git add server/src/server.ts
git commit -m "refactor(server): organize createServer; add /assets static serving for dev"
```

---

## Task 12: Client deps + Zustand stores

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (regenerated)
- Create: `client/src/stores/dmStore.ts`
- Create: `client/src/stores/playerStore.ts`

- [ ] **Step 1: Add `zustand` to `package.json` dependencies**

In `dependencies`, add:
```json
    "zustand": "^5.0.0",
```

The full block should now be:
```json
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "cookie": "^0.7.0",
    "express": "^4.21.0",
    "file-type": "^19.0.0",
    "multer": "^1.4.5-lts.1",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "sharp": "^0.33.5",
    "socket.io": "^4.8.0",
    "socket.io-client": "^4.8.0",
    "zustand": "^5.0.0"
  },
```

Run: `npm install`

- [ ] **Step 2: Create `client/src/stores/dmStore.ts`**

```ts
import { create } from 'zustand';

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

interface DmState {
  assets: ApiAsset[];
  pages: ApiPage[];
  selectedPageId: number | null;
  activePageId: number | null;

  setAssets: (a: ApiAsset[]) => void;
  upsertAsset: (a: ApiAsset) => void;
  setPages: (p: ApiPage[]) => void;
  upsertPage: (p: ApiPage) => void;
  removePage: (id: number) => void;
  selectPage: (id: number | null) => void;
  setActivePageId: (id: number | null) => void;
}

export const useDmStore = create<DmState>((set) => ({
  assets: [],
  pages: [],
  selectedPageId: null,
  activePageId: null,

  setAssets: (assets) => set({ assets }),
  upsertAsset: (asset) =>
    set((s) => {
      const idx = s.assets.findIndex((a) => a.id === asset.id);
      const next = [...s.assets];
      if (idx === -1) next.unshift(asset);
      else next[idx] = asset;
      return { assets: next };
    }),

  setPages: (pages) =>
    set({
      pages,
      activePageId: pages.find((p) => p.is_active === 1)?.id ?? null,
    }),
  upsertPage: (page) =>
    set((s) => {
      const idx = s.pages.findIndex((p) => p.id === page.id);
      let nextPages: ApiPage[];
      if (idx === -1) {
        nextPages = [...s.pages, page].sort((a, b) => a.sort_order - b.sort_order);
      } else {
        nextPages = [...s.pages];
        nextPages[idx] = page;
      }
      // If this page is the active one, clear is_active on others.
      if (page.is_active === 1) {
        nextPages = nextPages.map((p) =>
          p.id === page.id ? p : { ...p, is_active: 0 },
        );
      }
      return {
        pages: nextPages,
        activePageId: nextPages.find((p) => p.is_active === 1)?.id ?? null,
      };
    }),
  removePage: (id) =>
    set((s) => ({
      pages: s.pages.filter((p) => p.id !== id),
      selectedPageId: s.selectedPageId === id ? null : s.selectedPageId,
      activePageId: s.activePageId === id ? null : s.activePageId,
    })),
  selectPage: (id) => set({ selectedPageId: id }),
  setActivePageId: (id) =>
    set((s) => ({
      activePageId: id,
      pages: s.pages.map((p) => ({ ...p, is_active: p.id === id ? 1 : 0 })),
    })),
}));
```

- [ ] **Step 3: Create `client/src/stores/playerStore.ts`**

```ts
import { create } from 'zustand';
import type { ApiPage } from './dmStore.js';

interface PlayerState {
  activePage: ApiPage | null;
  setActivePage: (p: ApiPage | null) => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  activePage: null,
  setActivePage: (activePage) => set({ activePage }),
}));
```

- [ ] **Step 4: Typecheck + commit**

Run: `npm run typecheck`
Expected: clean (the stores don't have callers yet but the types are well-formed).

```bash
git add package.json package-lock.json client/src/stores/dmStore.ts client/src/stores/playerStore.ts
git commit -m "feat(client): zustand stores for DM and Player state"
```

---

## Task 13: Client API wrappers

**Files:**
- Modify: `client/src/api.ts`

- [ ] **Step 1: Append the new wrappers to `client/src/api.ts`**

Add these exports below the existing ones at the end of `client/src/api.ts`:
```ts
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
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add client/src/api.ts
git commit -m "feat(client): typed API wrappers for assets and pages"
```

---

## Task 14: DM UI — sidebar, library, modal, canvas

**Files:**
- Create: `client/src/dm/PagesSidebar.tsx`
- Create: `client/src/dm/MapsLibrary.tsx`
- Create: `client/src/dm/NewPageModal.tsx`
- Create: `client/src/dm/DmCanvas.tsx`
- Modify: `client/src/DmApp.tsx`

- [ ] **Step 1: Create `client/src/dm/PagesSidebar.tsx`**

```tsx
import { useDmStore } from '../stores/dmStore.js';
import { deletePage as apiDeletePage, setActivePage as apiSetActivePage } from '../api.js';

interface Props {
  onNewPage: () => void;
}

export default function PagesSidebar({ onNewPage }: Props) {
  const pages = useDmStore((s) => s.pages);
  const selectedPageId = useDmStore((s) => s.selectedPageId);
  const selectPage = useDmStore((s) => s.selectPage);

  async function handleSetActive(id: number) {
    try {
      await apiSetActivePage(id);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete page "${name}"?`)) return;
    try {
      await apiDeletePage(id);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <section style={{ borderBottom: '1px solid #ddd', padding: '0.75rem' }}>
      <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Pages</h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {pages.map((p) => (
          <li
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.25rem',
              background: selectedPageId === p.id ? '#eef' : 'transparent',
              cursor: 'pointer',
            }}
            onClick={() => selectPage(p.id)}
          >
            <span style={{ flex: 1 }}>
              {p.name}
              {p.is_active === 1 && <strong title="active"> ★</strong>}
            </span>
            {p.is_active === 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSetActive(p.id);
                }}
                style={{ fontSize: '0.75rem' }}
              >
                Set active
              </button>
            )}
            <button
              type="button"
              aria-label={`delete ${p.name}`}
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(p.id, p.name);
              }}
              style={{ fontSize: '0.75rem' }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onNewPage} style={{ marginTop: '0.5rem' }}>
        + New page
      </button>
    </section>
  );
}
```

- [ ] **Step 2: Create `client/src/dm/MapsLibrary.tsx`**

```tsx
import { useRef } from 'react';
import { useDmStore } from '../stores/dmStore.js';
import { uploadMapAsset } from '../api.js';

export default function MapsLibrary() {
  const assets = useDmStore((s) => s.assets);
  const upsertAsset = useDmStore((s) => s.upsertAsset);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      try {
        const asset = await uploadMapAsset(file);
        upsertAsset(asset);
      } catch (err) {
        alert(`upload failed: ${(err as Error).message}`);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <section style={{ padding: '0.75rem' }}>
      <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Maps</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
        {assets.map((a) => (
          <div
            key={a.id}
            title={a.originalName}
            style={{
              aspectRatio: '1',
              background: '#f0f0f0',
              backgroundImage: `url(/assets/${a.hash}.thumb.webp)`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              border: '1px solid #ccc',
            }}
          />
        ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(e) => handleFiles(e.target.files)}
        style={{ marginTop: '0.5rem' }}
      />
    </section>
  );
}
```

- [ ] **Step 3: Create `client/src/dm/NewPageModal.tsx`**

```tsx
import { useState } from 'react';
import { useDmStore } from '../stores/dmStore.js';
import { createPage } from '../api.js';

interface Props {
  onClose: () => void;
}

export default function NewPageModal({ onClose }: Props) {
  const assets = useDmStore((s) => s.assets);
  const upsertPage = useDmStore((s) => s.upsertPage);
  const [name, setName] = useState('');
  const [assetId, setAssetId] = useState<number | null>(assets[0]?.id ?? null);
  const [width, setWidth] = useState(20);
  const [height, setHeight] = useState(15);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (assetId === null) {
      setError('Upload a map first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const page = await createPage({
        name: name.trim(),
        background_asset_id: assetId,
        grid_width_squares: width,
        grid_height_squares: height,
      });
      upsertPage(page);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="New page"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: 8,
          minWidth: 320,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        <h2 style={{ margin: 0 }}>New page</h2>
        <label>
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <label>
          Map background
          <select
            value={assetId ?? ''}
            onChange={(e) => setAssetId(e.target.value ? Number(e.target.value) : null)}
            required
            style={{ display: 'block', width: '100%' }}
          >
            <option value="" disabled>
              {assets.length === 0 ? '— upload one first —' : '— pick a map —'}
            </option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.originalName}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <label style={{ flex: 1 }}>
            Grid width (squares)
            <input
              type="number"
              min={1}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              style={{ display: 'block', width: '100%' }}
            />
          </label>
          <label style={{ flex: 1 }}>
            Grid height (squares)
            <input
              type="number"
              min={1}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              style={{ display: 'block', width: '100%' }}
            />
          </label>
        </div>
        {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting || name.trim().length === 0}>
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Create `client/src/dm/DmCanvas.tsx`**

```tsx
import { useDmStore } from '../stores/dmStore.js';

export default function DmCanvas() {
  const selectedPageId = useDmStore((s) => s.selectedPageId);
  const page = useDmStore((s) => s.pages.find((p) => p.id === selectedPageId) ?? null);

  return (
    <div
      style={{
        flex: 1,
        background: '#222',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {page?.background_url ? (
        <img
          src={page.background_url}
          alt={page.name}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      ) : (
        <p style={{ color: '#888' }}>
          {page ? 'No background.' : 'Select or create a page.'}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Replace `client/src/DmApp.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import { bootstrapDm, listMapAssets, listPages, type ApiAsset, type ApiPage } from './api.js';
import { useDmStore } from './stores/dmStore.js';
import PagesSidebar from './dm/PagesSidebar.js';
import MapsLibrary from './dm/MapsLibrary.js';
import NewPageModal from './dm/NewPageModal.js';
import DmCanvas from './dm/DmCanvas.js';

type Phase = 'bootstrapping' | 'connecting' | 'connected' | 'error';

export default function DmApp() {
  const [phase, setPhase] = useState<Phase>('bootstrapping');
  const [error, setError] = useState<string | null>(null);
  const [showNewPage, setShowNewPage] = useState(false);

  const setAssets = useDmStore((s) => s.setAssets);
  const upsertAsset = useDmStore((s) => s.upsertAsset);
  const setPages = useDmStore((s) => s.setPages);
  const upsertPage = useDmStore((s) => s.upsertPage);
  const removePage = useDmStore((s) => s.removePage);
  const setActivePageId = useDmStore((s) => s.setActivePageId);

  useEffect(() => {
    let cancelled = false;

    bootstrapDm()
      .then(async () => {
        if (cancelled) return;
        setPhase('connecting');
        socket.connect();
        const [assets, pages] = await Promise.all([listMapAssets(), listPages()]);
        if (cancelled) return;
        setAssets(assets);
        setPages(pages);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setPhase('error');
      });

    const onConnect = () => setPhase('connected');
    const onDisconnect = () => setPhase('connecting');
    const onAssetCreated = (payload: { asset: ApiAsset }) => upsertAsset(payload.asset);
    const onPageCreated = (payload: { page: ApiPage }) => upsertPage(payload.page);
    const onPageUpdated = (payload: { page: ApiPage }) => upsertPage(payload.page);
    const onPageDeleted = (payload: { id: number }) => removePage(payload.id);
    const onActiveChanged = (payload: { activePage: ApiPage | null }) => {
      setActivePageId(payload.activePage?.id ?? null);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('asset:created', onAssetCreated);
    socket.on('page:created', onPageCreated);
    socket.on('page:updated', onPageUpdated);
    socket.on('page:deleted', onPageDeleted);
    socket.on('state:active_page_changed', onActiveChanged);

    return () => {
      cancelled = true;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('asset:created', onAssetCreated);
      socket.off('page:created', onPageCreated);
      socket.off('page:updated', onPageUpdated);
      socket.off('page:deleted', onPageDeleted);
      socket.off('state:active_page_changed', onActiveChanged);
    };
  }, [setAssets, upsertAsset, setPages, upsertPage, removePage, setActivePageId]);

  if (phase === 'error') {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <h1>Virtual Tabletop — DM</h1>
        <p style={{ color: 'crimson' }}>Error: {error}</p>
      </main>
    );
  }

  if (phase === 'bootstrapping') {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <p>Authenticating…</p>
      </main>
    );
  }

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        height: '100vh',
        display: 'grid',
        gridTemplateColumns: '260px 1fr',
        gridTemplateRows: 'auto 1fr',
      }}
    >
      <header
        style={{
          gridColumn: '1 / 3',
          padding: '0.5rem 1rem',
          borderBottom: '1px solid #ddd',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        <strong>VTT — DM</strong>
        <span style={{ color: '#888', fontSize: '0.85rem' }}>
          {phase === 'connected' ? 'connected' : 'connecting…'}
        </span>
      </header>
      <aside style={{ borderRight: '1px solid #ddd', overflowY: 'auto' }}>
        <PagesSidebar onNewPage={() => setShowNewPage(true)} />
        <MapsLibrary />
      </aside>
      <DmCanvas />
      {showNewPage && <NewPageModal onClose={() => setShowNewPage(false)} />}
    </div>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Build the client**

Run: `npm run build:client`
Expected: succeeds.

- [ ] **Step 8: Commit**

```bash
git add client/src/dm/PagesSidebar.tsx client/src/dm/MapsLibrary.tsx client/src/dm/NewPageModal.tsx client/src/dm/DmCanvas.tsx client/src/DmApp.tsx
git commit -m "feat(client): DM sidebar, maps library, new-page modal, canvas placeholder"
```

---

## Task 15: Player UI — active page render + socket listeners

**Files:**
- Create: `client/src/player/PlayerCanvas.tsx`
- Modify: `client/src/PlayerApp.tsx`

- [ ] **Step 1: Create `client/src/player/PlayerCanvas.tsx`**

```tsx
import { usePlayerStore } from '../stores/playerStore.js';

export default function PlayerCanvas() {
  const activePage = usePlayerStore((s) => s.activePage);

  return (
    <div
      style={{
        flex: 1,
        background: '#111',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {activePage?.background_url ? (
        <img
          src={activePage.background_url}
          alt={activePage.name}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      ) : (
        <p style={{ color: '#888' }}>Waiting for the DM…</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace `client/src/PlayerApp.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import { getMe, type Player, type ApiPage } from './api.js';
import NamePicker from './NamePicker.js';
import PlayerCanvas from './player/PlayerCanvas.js';
import { usePlayerStore } from './stores/playerStore.js';

type Phase = 'loading' | 'name-picker' | 'connecting' | 'connected';

export default function PlayerApp() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [player, setPlayer] = useState<Player | null>(null);
  const setActivePage = usePlayerStore((s) => s.setActivePage);

  useEffect(() => {
    getMe()
      .then((me) => {
        if (me.role === 'player') {
          setPlayer(me.player);
          setPhase('connecting');
          socket.connect();
        } else if (me.role === 'dm') {
          setPhase('connecting');
          socket.connect();
        } else {
          setPhase('name-picker');
        }
      })
      .catch(() => setPhase('name-picker'));

    const onConnect = () => setPhase('connected');
    const onDisconnect = () => setPhase('connecting');
    const onFullSync = (payload: { activePage: ApiPage | null }) => {
      setActivePage(payload.activePage);
    };
    const onActiveChanged = (payload: { activePage: ApiPage | null }) => {
      setActivePage(payload.activePage);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state:full_sync', onFullSync);
    socket.on('state:active_page_changed', onActiveChanged);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state:full_sync', onFullSync);
      socket.off('state:active_page_changed', onActiveChanged);
    };
  }, [setActivePage]);

  function handleJoined(p: Player) {
    setPlayer(p);
    setPhase('connecting');
    socket.connect();
  }

  if (phase === 'name-picker') {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <h1>Virtual Tabletop</h1>
        <NamePicker onJoined={handleJoined} />
      </main>
    );
  }

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          padding: '0.5rem 1rem',
          borderBottom: '1px solid #ddd',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        <strong>VTT</strong>
        <span style={{ color: '#888', fontSize: '0.85rem' }}>
          {phase === 'connected' ? 'connected' : 'connecting…'}
        </span>
        {player && (
          <span style={{ marginLeft: 'auto' }}>
            Hi, <strong style={{ color: player.color }}>{player.name}</strong>
          </span>
        )}
      </header>
      <PlayerCanvas />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + client build**

Run: `npm run typecheck && npm run build:client`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add client/src/player/PlayerCanvas.tsx client/src/PlayerApp.tsx
git commit -m "feat(client): player full-bleed active-page render + sync listeners"
```

---

## Task 16: Caddyfile — serve `/assets/*` directly

**Files:**
- Modify: `infra/caddy/Caddyfile.vtt`

- [ ] **Step 1: Insert a `handle_path /assets/*` block at the top of the site block**

Read the current `infra/caddy/Caddyfile.vtt`. Find this line:
```
vtt.5edice.com {
    encode gzip
```

Add immediately after `encode gzip` (so the assets handler is matched before the API/SPA handlers):
```

    # Static asset bytes (uploaded maps & thumbs). Served directly from disk —
    # never touches Node. Hash-based URLs are immutable, so we cache forever.
    handle_path /assets/* {
        root * /home/ubuntu/services/vtt/uploads
        file_server
        header Cache-Control "public, max-age=31536000, immutable"
    }
```

The full file now reads as:
```
vtt.5edice.com {
    encode gzip

    # Static asset bytes (uploaded maps & thumbs). Served directly from disk —
    # never touches Node. Hash-based URLs are immutable, so we cache forever.
    handle_path /assets/* {
        root * /home/ubuntu/services/vtt/uploads
        file_server
        header Cache-Control "public, max-age=31536000, immutable"
    }

    # DM API: gated by DM Basic Auth; proxied to Node.
    handle /api/dm/* {
        ...
    }
    ...
}
```

(Leave all other handlers unchanged.)

- [ ] **Step 2: Commit**

```bash
git add infra/caddy/Caddyfile.vtt
git commit -m "infra(caddy): serve /assets/* directly from uploads dir with immutable cache headers"
```

---

## Task 17: Final integration check

**Files:** none modified.

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all green. Should be ~30 unit/integration tests now (existing M2 tests + new ones from Tasks 2–10).

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: `dist/server.js` and `public/index.html` produced; no errors.

- [ ] **Step 4: Smoke test in dev**

Generate an APP_SECRET and write a `.env` (skip if you already have one from M2):

```bash
test -f .env || (cp .env.example .env && sed -i "s/^APP_SECRET=$/APP_SECRET=$(openssl rand -hex 32)/" .env)
```

Then in two terminals:
- `npm run dev:server` — should print `vtt server listening on :3002`.
- `npm run dev:client` — Vite serves the client; note the URL it prints (typically `http://localhost:5173`).

Open `http://localhost:5173/dm` in one browser tab and `http://localhost:5173/` in another. You should be able to:
1. (DM) See "VTT — DM" header. Upload a small PNG via the Maps library file picker. A thumbnail appears.
2. (DM) Click "+ New page", pick the uploaded map, name it, click Create. The page appears in the sidebar.
3. (DM) Click "Set active". The "★" appears next to that page in the sidebar.
4. (Player) After picking a name, the player view shows the map full-bleed. If the DM swaps the active page to a different one, the player view updates within ~100 ms.

If any step fails, debug it before moving on. (Vite proxies `/api/*` and `/socket.io/*` to the dev server via its built-in proxy config; if not, check `vite.config.ts` — that wiring should already be in place from M1/M2.)

- [ ] **Step 5: No-op commit (optional)**

If you discovered a small fix during smoke-testing, commit it with a clear message. Otherwise, this task ends without a commit.

---

## Out of scope for M3 (do NOT implement)

- `DELETE /api/dm/assets/:id` and asset garbage collection.
- Page reorder UI (drag-and-drop on the sidebar).
- Token uploads (M4).
- Grid overlay rendering (M4 — react-konva lands then).
- Fog of war (M5).
- Rate limiting on `POST /api/dm/assets/upload`. Multer's per-request size cap is sufficient for the personal-app threat model. If a polish pass adds it later, implement as a tiny in-memory token bucket keyed by the DM cookie.
- Pan/zoom on player canvas. M3 player view is a static `<img>`.

## Done criteria recap

- [ ] All 17 tasks complete; each ended with one focused commit.
- [ ] `npm test` green.
- [ ] `npm run typecheck` clean.
- [ ] `npm run build` succeeds.
- [ ] Manual smoke test (Task 17 Step 4) passes end-to-end.
