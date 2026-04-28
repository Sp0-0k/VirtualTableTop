# M1: Skeleton & Deploy Harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a "walking skeleton" of the VTT — Express + Socket.IO server, React + Vite client, build pipelines for both, and the EC2 deployment harness — so the next milestone (auth) has a working delivery pipeline to build on.

**Architecture:** Single Node process serving both an HTTP API (Express) and real-time WebSockets (Socket.IO) from one port. React client built by Vite into static assets, served by nginx (reverse proxy in front of Node). Server bundled with esbuild into a single file. Tested with vitest. Deployed to EC2 under systemd, behind nginx with TLS via certbot.

**Tech Stack:** Node.js (LTS), TypeScript, Express, Socket.IO, React 18, Vite, esbuild, vitest, supertest, socket.io-client (test). Out-of-scope for M1: SQLite, sharp, react-konva, Zustand, auth (all land in M2+).

**M1 Done When:** Deployed to `https://vtt.<your-domain>`, page loads, browser shows "connected" via WebSocket. Tests pass locally and in CI-like `npm test` invocation.

**Reference:** `docs/superpowers/specs/2026-04-27-vtt-design.md` is the design source of truth.

**Conventions:**
- ESM everywhere (`"type": "module"` in `package.json`).
- All TS strict; no `any` unless explicitly justified.
- Source layout: `server/src/**` (Node), `client/src/**` (browser), `tests/**` (server tests; client smoke tests come in M6+).
- Build outputs: `dist/server.js` (server bundle), `public/` (client static bundle).
- Each task ends with a small, focused commit.

---

## File Structure

Files this milestone creates or modifies. Each path appears in exactly one task's "Create" section.

```
/                                        (project root)
├── package.json                          Task 1
├── tsconfig.base.json                    Task 2
├── tsconfig.server.json                  Task 2
├── tsconfig.client.json                  Task 2
├── vitest.config.ts                      Task 2
├── README.md                             Task 1
├── .gitignore                            modified Task 1 (already exists from spec commit)
├── server/
│   └── src/
│       ├── server.ts                     Task 3 (entry + createServer factory)
│       ├── socket.ts                     Task 4 (Socket.IO setup)
│       └── routes/
│           └── health.ts                 Task 3 (Express health route)
├── client/
│   ├── index.html                        Task 6
│   └── src/
│       ├── main.tsx                      Task 6 (React entry)
│       ├── App.tsx                       Task 6 (then modified Task 7)
│       └── socket.ts                     Task 7 (Socket.IO client singleton)
├── tests/
│   ├── health.test.ts                    Task 3
│   └── socket.test.ts                    Task 4
├── vite.config.ts                        Task 6
├── esbuild.config.mjs                    Task 5
├── infra/
│   ├── nginx/
│   │   └── vtt.conf                      Task 9
│   ├── systemd/
│   │   └── vtt.service                   Task 10
│   └── scripts/
│       └── setup-host.sh                 Task 11
└── docs/
    └── DEPLOY.md                         Task 12
```

**File responsibilities:**

- `server/src/server.ts` — exports `createServer()` factory that returns an `http.Server` with Express + Socket.IO attached. Bottom of file has an entry guard that calls `listen()` only when run directly (not when imported by tests).
- `server/src/socket.ts` — the `attachSocketIO(httpServer)` function that wires up the Socket.IO server and connection handlers. Kept separate so tests and the entry can compose it the same way.
- `server/src/routes/health.ts` — Express router exporting a single `GET /` returning `{ ok: true }` (mounted at `/api/health` by `server.ts`).
- `client/src/socket.ts` — exports a configured Socket.IO client singleton.
- `client/src/App.tsx` — renders connection status, derived from the socket singleton.
- `infra/nginx/vtt.conf` — nginx site config. M1 version has no auth gates (those land in M2). Proxies `/socket.io/` (with WS upgrade), `/api/`, and serves `/` from the static bundle.
- `infra/systemd/vtt.service` — systemd unit per the spec.
- `infra/scripts/setup-host.sh` — one-time host setup (creates `vtt` user, dirs, copies configs into place). Idempotent.

---

## Task 1: Initialize project skeleton

**Files:**
- Create: `package.json`
- Create: `README.md`
- Modify: `.gitignore` (already exists; ensure correct)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "vtt",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Single-campaign D&D virtual tabletop",
  "scripts": {
    "dev:server": "node --import tsx --watch server/src/server.ts",
    "dev:client": "vite",
    "build:server": "node esbuild.config.mjs",
    "build:client": "vite build",
    "build": "npm run build:server && npm run build:client",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit"
  },
  "dependencies": {
    "express": "^4.21.0",
    "socket.io": "^4.8.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "socket.io-client": "^4.8.0"
  },
  "devDependencies": {
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
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Create `README.md`**

```markdown
# Virtual Tabletop

Single-campaign D&D virtual tabletop. Hosts the visual/spatial layer of play
(maps, tokens, fog of war) for one DM and a small group of players.

## Documents

- Design spec: [`docs/superpowers/specs/2026-04-27-vtt-design.md`](docs/superpowers/specs/2026-04-27-vtt-design.md)
- Implementation plans: [`docs/superpowers/plans/`](docs/superpowers/plans/)

## Development

```bash
npm install
npm run dev:server   # in one terminal
npm run dev:client   # in another terminal
```

Server runs on :3000, client dev server on :5173 (Vite default), proxying
`/api` and `/socket.io` to the server.

## Tests

```bash
npm test          # one-shot
npm run test:watch
npm run typecheck
```

## Deploy

See [`docs/DEPLOY.md`](docs/DEPLOY.md).
```

- [ ] **Step 3: Verify `.gitignore` has node_modules, dist, public/build outputs**

The `.gitignore` from the spec commit already has the right entries. Run:

```bash
grep -E '^(node_modules/|dist/|public/)' .gitignore
```

Expected output:
```
node_modules/
dist/
```

If `public/` is missing, add it (Vite outputs the client build there):

```bash
grep -q '^public/$' .gitignore || echo 'public/' >> .gitignore
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`

Expected: completes successfully, creates `package-lock.json` and `node_modules/`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json README.md .gitignore
git commit -m "chore: initialize project skeleton with package.json"
```

---

## Task 2: TypeScript configs and Vitest config

**Files:**
- Create: `tsconfig.base.json`
- Create: `tsconfig.server.json`
- Create: `tsconfig.client.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- [ ] **Step 2: Create `tsconfig.server.json`**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "outDir": "./dist",
    "rootDir": "./",
    "noEmit": true
  },
  "include": ["server/**/*", "tests/**/*", "esbuild.config.mjs", "vitest.config.ts"]
}
```

`noEmit: true` because esbuild is the actual compiler. tsc is used only for type checking.

- [ ] **Step 3: Create `tsconfig.client.json`**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "noEmit": true
  },
  "include": ["client/**/*", "vite.config.ts"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 5: Verify typecheck runs (no source files yet, should still succeed)**

Run: `npm run typecheck`

Expected: exits 0 with no output (or empty success). If it errors about no input files, that's fine — Task 3 will add files.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.base.json tsconfig.server.json tsconfig.client.json vitest.config.ts
git commit -m "chore: add tsconfig and vitest config"
```

---

## Task 3: Server entry + health route (TDD)

**Files:**
- Create: `server/src/routes/health.ts`
- Create: `server/src/server.ts`
- Create: `tests/health.test.ts`

- [ ] **Step 1: Write the failing test (`tests/health.test.ts`)**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'http';
import { createServer } from '../server/src/server.js';

describe('GET /api/health', () => {
  let server: Server;

  beforeAll(() => {
    server = createServer();
  });

  afterAll(() => {
    server.close();
  });

  it('returns 200 with { ok: true }', async () => {
    const res = await request(server).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/health.test.ts`

Expected: FAIL — module `'../server/src/server.js'` not found.

- [ ] **Step 3: Implement the health route (`server/src/routes/health.ts`)**

```ts
import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ ok: true });
});

export default router;
```

- [ ] **Step 4: Implement the server factory (`server/src/server.ts`)**

```ts
import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import healthRouter from './routes/health.js';

export function createServer(): http.Server {
  const app = express();

  app.use(express.json());
  app.use('/api/health', healthRouter);

  return http.createServer(app);
}

// Entry guard: only listen() when run directly, not when imported by tests.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] === thisFile) {
  const server = createServer();
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    console.log(`vtt server listening on :${port}`);
  });
}
```

Note: imports use `.js` extensions because esbuild + Node's ESM resolution requires explicit extensions. TypeScript with `moduleResolution: Bundler` allows you to write `.js` even though the source is `.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/health.test.ts`

Expected: PASS, 1 test in 1 suite.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 7: Smoke-run the server**

Run: `npm run dev:server`

Expected: console prints `vtt server listening on :3000`. In another terminal, `curl http://localhost:3000/api/health` returns `{"ok":true}`.

Stop the dev server with Ctrl-C.

- [ ] **Step 8: Commit**

```bash
git add server/ tests/health.test.ts
git commit -m "feat(server): add health endpoint with createServer factory"
```

---

## Task 4: Socket.IO with hello event (TDD)

**Files:**
- Create: `server/src/socket.ts`
- Modify: `server/src/server.ts`
- Create: `tests/socket.test.ts`

- [ ] **Step 1: Write the failing test (`tests/socket.test.ts`)**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createServer } from '../server/src/server.js';

describe('Socket.IO server', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    url = `http://localhost:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('emits hello on client connect', () => {
    return new Promise<void>((resolve, reject) => {
      const client: ClientSocket = ioc(url, { transports: ['websocket'] });
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/socket.test.ts`

Expected: FAIL — `createServer` does not attach Socket.IO yet, the test times out.

- [ ] **Step 3: Implement Socket.IO setup (`server/src/socket.ts`)**

```ts
import type http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';

export function attachSocketIO(httpServer: http.Server): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: false }, // same-origin only
  });

  io.on('connection', (socket) => {
    socket.emit('hello', { greeting: 'connected' });
  });

  return io;
}
```

- [ ] **Step 4: Wire Socket.IO into the server factory (modify `server/src/server.ts`)**

Replace the entire file with:

```ts
import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import healthRouter from './routes/health.js';
import { attachSocketIO } from './socket.js';

export function createServer(): http.Server {
  const app = express();

  app.use(express.json());
  app.use('/api/health', healthRouter);

  const httpServer = http.createServer(app);
  attachSocketIO(httpServer);

  return httpServer;
}

// Entry guard: only listen() when run directly, not when imported by tests.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] === thisFile) {
  const server = createServer();
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    console.log(`vtt server listening on :${port}`);
  });
}
```

- [ ] **Step 5: Run socket test to verify it passes**

Run: `npm test -- tests/socket.test.ts`

Expected: PASS, 1 test.

- [ ] **Step 6: Run all tests to verify health test still passes**

Run: `npm test`

Expected: PASS, 2 tests across 2 files.

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add server/src/socket.ts server/src/server.ts tests/socket.test.ts
git commit -m "feat(server): add Socket.IO with hello event on connect"
```

---

## Task 5: Server build with esbuild

**Files:**
- Create: `esbuild.config.mjs`
- Modify: `package.json` (already has `build:server` script)

- [ ] **Step 1: Create `esbuild.config.mjs`**

```js
import { build } from 'esbuild';

await build({
  entryPoints: ['server/src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/server.js',
  sourcemap: true,
  // Native modules and runtime-only deps stay external — they get loaded
  // from node_modules at runtime instead of being bundled. (For M1, none
  // of our deps are native; sharp/better-sqlite3 land in M2/M3.)
  packages: 'external',
  banner: {
    // ESM bundles need a `require` shim because some transitive deps
    // (e.g. inside Express) still call require() under the hood.
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});

console.log('Built dist/server.js');
```

- [ ] **Step 2: Run the build**

Run: `npm run build:server`

Expected: prints `Built dist/server.js`. `dist/server.js` exists.

- [ ] **Step 3: Smoke-run the bundle**

Run: `node dist/server.js`

Expected: prints `vtt server listening on :3000`. Stop with Ctrl-C.

- [ ] **Step 4: Verify the bundle is reasonable size (sanity check)**

Run: `ls -lh dist/server.js`

Expected: a single file, somewhere between 100KB and 2MB. If it's larger, esbuild may have bundled `node_modules` despite `packages: 'external'`.

- [ ] **Step 5: Commit**

```bash
git add esbuild.config.mjs
git commit -m "build(server): add esbuild bundler config"
```

---

## Task 6: Client scaffolding (Vite + React)

**Files:**
- Create: `vite.config.ts`
- Create: `client/index.html`
- Create: `client/src/main.tsx`
- Create: `client/src/App.tsx`

- [ ] **Step 1: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    sourcemap: true,
  },
});
```

The dev server runs on :5173 and proxies `/api` and `/socket.io` to the server on :3000, so both can run simultaneously without CORS hassle.

- [ ] **Step 2: Create `client/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VTT</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 3: Create `client/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 4: Create a placeholder `client/src/App.tsx`**

```tsx
export default function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Virtual Tabletop</h1>
      <p>Skeleton page — Socket.IO connection comes in Task 7.</p>
    </main>
  );
}
```

- [ ] **Step 5: Run the client dev server and visually verify**

In one terminal: `npm run dev:server`
In another: `npm run dev:client`

Open http://localhost:5173 in a browser. Expected: page shows "Virtual Tabletop" heading and the placeholder paragraph.

Stop both with Ctrl-C.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts client/
git commit -m "feat(client): scaffold React + Vite client"
```

---

## Task 7: Client connects via Socket.IO and shows status

**Files:**
- Create: `client/src/socket.ts`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create `client/src/socket.ts`**

```ts
import { io, type Socket } from 'socket.io-client';

// Same-origin connection. Vite dev server proxies /socket.io to the API server.
// In production, nginx does the same — clients always speak to their origin.
export const socket: Socket = io({
  transports: ['websocket'],
  autoConnect: true,
});
```

- [ ] **Step 2: Replace `client/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { socket } from './socket.js';

type Status = 'connecting' | 'connected' | 'disconnected';

export default function App() {
  const [status, setStatus] = useState<Status>(socket.connected ? 'connected' : 'connecting');
  const [greeting, setGreeting] = useState<string | null>(null);

  useEffect(() => {
    const onConnect = () => setStatus('connected');
    const onDisconnect = () => setStatus('disconnected');
    const onHello = (msg: { greeting: string }) => setGreeting(msg.greeting);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('hello', onHello);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('hello', onHello);
    };
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Virtual Tabletop</h1>
      <p>
        Socket: <strong>{status}</strong>
        {greeting && <> — server says &ldquo;{greeting}&rdquo;</>}
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Smoke-test in the browser**

In one terminal: `npm run dev:server`
In another: `npm run dev:client`

Open http://localhost:5173. Expected: page shows `Socket: connected — server says "connected"`.

Open browser devtools → Network → filter WS. You should see one `socket.io/?EIO=4...` connection in the upgraded WebSocket state.

Stop dev servers with Ctrl-C.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 5: Run all tests**

Run: `npm test`

Expected: PASS, 2 tests still passing (no client tests yet).

- [ ] **Step 6: Commit**

```bash
git add client/src/
git commit -m "feat(client): connect via Socket.IO and display status"
```

---

## Task 8: Verify production build works end-to-end

**Files:** none (verification task)

- [ ] **Step 1: Build everything**

Run: `npm run build`

Expected: prints `Built dist/server.js`, then Vite prints its build summary. Both `dist/server.js` and `public/index.html` exist after.

- [ ] **Step 2: Verify built output**

```bash
ls dist/      # expect: server.js, server.js.map
ls public/    # expect: index.html, assets/ directory
```

- [ ] **Step 3: Run the built server**

Run: `node dist/server.js`

Expected: prints `vtt server listening on :3000`.

- [ ] **Step 4: Hit the API directly**

In another terminal: `curl http://localhost:3000/api/health`

Expected: `{"ok":true}`.

- [ ] **Step 5: Serve the static client temporarily and verify the WS works**

In another terminal:

```bash
cd public && python3 -m http.server 8080
```

Open http://localhost:8080 — but wait: the Vite proxy is gone in this configuration, and the client connects to its own origin (8080), where there is no Socket.IO. **Expect Status: disconnected.** This is fine for this step — it confirms the client is correctly attempting same-origin (which is what nginx will satisfy in production).

To fully verify the prod-like flow, the next step (after deployment in Task 13) is the real test. For now, stop the http.server and node, no commit needed.

- [ ] **Step 6: No commit — this was a verification task**

(Skip the commit step.)

---

## Task 9: nginx site config

**Files:**
- Create: `infra/nginx/vtt.conf`

- [ ] **Step 1: Create `infra/nginx/vtt.conf`**

```nginx
# M1: skeleton config — no Basic Auth gates yet (those land in M2).
# Place at /etc/nginx/sites-available/vtt.conf and symlink to sites-enabled.
# Replace vtt.example.com with your actual subdomain.

upstream vtt_node {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name vtt.example.com;

    ssl_certificate     /etc/letsencrypt/live/vtt.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vtt.example.com/privkey.pem;

    # 5MB upload limit + headroom (used in M3+).
    client_max_body_size 6m;

    # Static React bundle.
    root /opt/vtt/public;
    index index.html;

    # Socket.IO with WebSocket upgrade.
    location /socket.io/ {
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://vtt_node;
        proxy_read_timeout 3600;
    }

    # API.
    location /api/ {
        proxy_pass http://vtt_node;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SPA fallback for the root.
    location / {
        try_files $uri /index.html;
    }
}

# Redirect HTTP to HTTPS.
server {
    listen 80;
    server_name vtt.example.com;
    return 301 https://$host$request_uri;
}
```

Note: the design spec's full nginx config (with Basic Auth on `/dm` and `/`, and a separate `/api/dm/` location) lands in M2 once the auth bootstrap endpoint exists. For M1, the goal is to prove the deploy/serve pipeline works end-to-end.

- [ ] **Step 2: Commit**

```bash
git add infra/nginx/vtt.conf
git commit -m "infra(nginx): add M1 site config without auth gates"
```

---

## Task 10: systemd service unit

**Files:**
- Create: `infra/systemd/vtt.service`

- [ ] **Step 1: Create `infra/systemd/vtt.service`**

```ini
# Place at /etc/systemd/system/vtt.service.
# Run `sudo systemctl daemon-reload` after editing.

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

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/vtt /var/log/vtt
PrivateTmp=true

# Logging — append to a single file; logrotate handles rotation separately.
StandardOutput=append:/var/log/vtt/app.log
StandardError=append:/var/log/vtt/app.log

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Commit**

```bash
git add infra/systemd/vtt.service
git commit -m "infra(systemd): add vtt.service unit"
```

---

## Task 11: Host setup script

**Files:**
- Create: `infra/scripts/setup-host.sh`

- [ ] **Step 1: Create `infra/scripts/setup-host.sh`**

```bash
#!/usr/bin/env bash
# One-time host setup for the VTT app on EC2 (Ubuntu).
# Idempotent: safe to re-run.
#
# Usage (on the EC2 box):
#   sudo bash infra/scripts/setup-host.sh
#
# What it does:
#   - creates the `vtt` system user and group
#   - creates /opt/vtt, /var/lib/vtt/uploads, /var/log/vtt, /etc/vtt
#   - copies the systemd unit and nginx site config into place (does NOT enable
#     them — that's a separate manual step so you can review first)
#   - leaves /etc/vtt/env for you to populate with secrets
#
# Does NOT do (out of scope for M1):
#   - install dependencies (do `sudo apt install nginx nodejs certbot python3-certbot-nginx`)
#   - run certbot (do `sudo certbot --nginx -d <your-subdomain>` after editing
#     vtt.conf to use your real subdomain)
#   - generate APP_SECRET (do `echo "APP_SECRET=$(openssl rand -hex 32)" | sudo tee -a /etc/vtt/env`)
#   - install/build the application (deploy script handles that)

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Must run as root (use sudo)." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[setup-host] using repo at $REPO_ROOT"

# 1. User and group
if ! id -u vtt >/dev/null 2>&1; then
  echo "[setup-host] creating user vtt"
  useradd --system --home /opt/vtt --shell /usr/sbin/nologin vtt
else
  echo "[setup-host] user vtt already exists"
fi

# 2. Directories
install -d -o vtt -g vtt -m 0755 /opt/vtt
install -d -o vtt -g vtt -m 0755 /var/lib/vtt /var/lib/vtt/uploads
install -d -o vtt -g vtt -m 0755 /var/log/vtt
install -d -o root -g root -m 0755 /etc/vtt

# 3. Env file (only create if missing — never overwrite)
if [[ ! -f /etc/vtt/env ]]; then
  echo "[setup-host] creating placeholder /etc/vtt/env (populate before starting service)"
  cat > /etc/vtt/env <<'EOF'
NODE_ENV=production
PORT=3000
# APP_SECRET is REQUIRED. Generate with: openssl rand -hex 32
# APP_SECRET=
CAMPAIGN_NAME=The Campaign
COOKIE_SECURE=1
TRUST_PROXY=1
EOF
  chown root:vtt /etc/vtt/env
  chmod 0640 /etc/vtt/env
else
  echo "[setup-host] /etc/vtt/env already exists, leaving as is"
fi

# 4. systemd unit
install -m 0644 "$REPO_ROOT/infra/systemd/vtt.service" /etc/systemd/system/vtt.service
systemctl daemon-reload
echo "[setup-host] installed /etc/systemd/system/vtt.service"
echo "[setup-host]   start with:  sudo systemctl enable --now vtt"

# 5. nginx site config (do not enable yet — operator must edit subdomain first)
install -m 0644 "$REPO_ROOT/infra/nginx/vtt.conf" /etc/nginx/sites-available/vtt.conf
echo "[setup-host] installed /etc/nginx/sites-available/vtt.conf"
echo "[setup-host]   edit it to set your real subdomain, then:"
echo "[setup-host]     sudo ln -sf /etc/nginx/sites-available/vtt.conf /etc/nginx/sites-enabled/"
echo "[setup-host]     sudo certbot --nginx -d <your-subdomain>"
echo "[setup-host]     sudo nginx -t && sudo systemctl reload nginx"

echo "[setup-host] done"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x infra/scripts/setup-host.sh
```

- [ ] **Step 3: Sanity-check syntax with bash**

Run: `bash -n infra/scripts/setup-host.sh`

Expected: no output (script parses cleanly).

- [ ] **Step 4: Commit**

```bash
git add infra/scripts/setup-host.sh
git commit -m "infra(scripts): add idempotent setup-host.sh"
```

---

## Task 12: Deploy documentation

**Files:**
- Create: `docs/DEPLOY.md`

- [ ] **Step 1: Create `docs/DEPLOY.md`**

```markdown
# Deployment

Production target: AWS EC2 instance running on a subdomain (`vtt.<your-domain>`),
behind nginx with Let's Encrypt TLS, supervised by systemd.

## One-time host setup

On the EC2 box:

1. Install dependencies:

   ```bash
   sudo apt update
   sudo apt install -y nginx nodejs certbot python3-certbot-nginx apache2-utils
   ```

2. Clone or copy this repo (anywhere; it's only needed for the setup script):

   ```bash
   git clone <repo-url> /tmp/vtt-setup   # or scp the repo over
   ```

3. Run the setup script (idempotent):

   ```bash
   sudo bash /tmp/vtt-setup/infra/scripts/setup-host.sh
   ```

4. Edit the nginx site config at `/etc/nginx/sites-available/vtt.conf` and
   replace `vtt.example.com` with your actual subdomain (4 places).

5. Generate the app secret:

   ```bash
   echo "APP_SECRET=$(openssl rand -hex 32)" | sudo tee -a /etc/vtt/env
   ```

6. Enable the nginx site and acquire a TLS certificate:

   ```bash
   sudo ln -sf /etc/nginx/sites-available/vtt.conf /etc/nginx/sites-enabled/
   sudo certbot --nginx -d vtt.<your-domain>
   sudo nginx -t && sudo systemctl reload nginx
   ```

## Build & deploy

The author has an existing per-subdomain deploy script for this EC2 instance.
Adapt that script to handle these VTT-specific steps:

**On the dev machine (pre-deploy):**

```bash
npm ci
npm run build      # produces dist/server.js + public/
```

**Files to ship to the EC2 box:**

- `dist/`               → `/opt/vtt/dist/`
- `public/`             → `/opt/vtt/public/`
- `package.json`        → `/opt/vtt/package.json`
- `package-lock.json`   → `/opt/vtt/package-lock.json`

(Don't ship `node_modules/` — `npm ci --omit=dev` runs on the EC2 box.)

**On the EC2 box (post-transfer):**

```bash
cd /opt/vtt
sudo -u vtt npm ci --omit=dev
sudo systemctl restart vtt
```

(Once migrations land in M2, this becomes:
`sudo -u vtt node /opt/vtt/dist/scripts/migrate.js && sudo systemctl restart vtt`.)

## First-deploy verification

After deploying, on your local machine:

```bash
curl https://vtt.<your-domain>/api/health
# → {"ok":true}
```

Then load `https://vtt.<your-domain>` in a browser. The page should show:

> Socket: connected — server says "connected"

If anything fails, check:

- `sudo journalctl -u vtt -n 100`           — Node app logs
- `sudo tail -f /var/log/nginx/error.log`   — nginx errors
- `sudo systemctl status vtt`               — service state

## Logs

App stdout/stderr land in `/var/log/vtt/app.log` (configured in the systemd
unit). Add a logrotate entry once volume warrants it.

## What this milestone (M1) does NOT include

- Auth (no Basic Auth gates yet — `/dm` and `/` are publicly reachable).
- The migrations runner (`scripts/migrate.js`).
- SQLite, image uploads, anything stateful.

These land in M2+.
```

- [ ] **Step 2: Commit**

```bash
git add docs/DEPLOY.md
git commit -m "docs: add M1 deployment guide"
```

---

## Task 13: First deploy and end-to-end verification

This task is partly manual and **must be done with the user's existing deploy script**. The user will hand over their script during this task; we adapt the post-transfer steps to match the layout in `docs/DEPLOY.md`.

**Files:** none (verification task — any script changes belong to the user's external deploy script repo, not this one)

- [ ] **Step 1: Request the user's existing deploy script**

Ask the user to share the script. Read it. Identify:

- How files are transferred to EC2 (rsync? scp? something else?)
- Where they land on the box
- What post-transfer commands run (currently)
- Any per-subdomain configuration mechanism

- [ ] **Step 2: Adapt the deploy script (out-of-tree change in the user's environment)**

Working with the user, modify their deploy script to:

- Run `npm run build` before transfer
- Transfer `dist/`, `public/`, `package.json`, `package-lock.json` (only these — not `node_modules`, not source) to `/opt/vtt/` on the EC2 box
- After transfer, run `npm ci --omit=dev` as the `vtt` user in `/opt/vtt`
- Restart with `sudo systemctl restart vtt`

This change is to the user's deploy script — do not commit it to this repo.

- [ ] **Step 3: Run the host setup script on EC2**

```bash
ssh ec2 sudo bash /tmp/vtt-setup/infra/scripts/setup-host.sh
```

(After `git push` from your dev machine and `git pull` or `scp` to put the repo somewhere on EC2 for the script to read from.)

- [ ] **Step 4: Edit `vtt.conf` on EC2 to use the real subdomain**

```bash
ssh ec2 sudo sed -i 's/vtt\.example\.com/vtt.<your-subdomain>/g' /etc/nginx/sites-available/vtt.conf
```

(Replace `<your-subdomain>` with the actual one. Verify with `grep server_name /etc/nginx/sites-available/vtt.conf`.)

- [ ] **Step 5: Generate APP_SECRET and write to env file**

```bash
ssh ec2 'echo "APP_SECRET=$(openssl rand -hex 32)" | sudo tee -a /etc/vtt/env'
```

- [ ] **Step 6: Enable nginx site and acquire TLS cert**

```bash
ssh ec2 'sudo ln -sf /etc/nginx/sites-available/vtt.conf /etc/nginx/sites-enabled/'
ssh ec2 sudo certbot --nginx -d vtt.<your-subdomain>
ssh ec2 'sudo nginx -t && sudo systemctl reload nginx'
```

- [ ] **Step 7: Run the adapted deploy script**

From the dev machine:

```bash
./<user-deploy-script> vtt
```

(Or whatever invocation the user's script uses.)

Expected: the script transfers built artifacts, runs `npm ci --omit=dev`, and restarts the service. No errors.

- [ ] **Step 8: Verify the API directly**

```bash
curl -fsS https://vtt.<your-subdomain>/api/health
```

Expected: `{"ok":true}`.

- [ ] **Step 9: Verify the full page in a browser**

Open `https://vtt.<your-subdomain>` in a browser.

Expected: page loads, shows `Socket: connected — server says "connected"`.

If browser shows `Status: disconnected`, check:

- `ssh ec2 sudo journalctl -u vtt -n 50` — server actually started?
- `ssh ec2 sudo tail -50 /var/log/nginx/error.log` — proxy errors?
- Browser devtools → Network → confirm `/socket.io/` request returns 101 Switching Protocols

- [ ] **Step 10: Commit nothing, but tag the milestone**

```bash
git tag m1-skeleton
git push --tags
```

(Tagging is optional but useful — provides a known-good rollback point before M2 lands auth.)

---

## M1 Completion Criteria

All checkboxes above completed, plus:

- `npm test` passes (2 tests).
- `npm run typecheck` exits 0.
- `npm run build` produces `dist/server.js` and `public/`.
- `https://vtt.<your-subdomain>` loads and shows "Socket: connected".
- The user's deploy script is adapted and lives in their existing tooling (not in this repo).

After completion, **the M2 plan (Auth + Name Picker)** can be drafted, building on this skeleton.

---

## Out of Scope Reminders (for the next plan)

These belong in M2 or later, not M1:

- nginx Basic Auth on `/dm` and `/`
- DM bootstrap endpoint
- Player join endpoint and name picker UI
- Cookie signing/verification helpers
- The `players` table and any SQLite at all
- The migration runner (`scripts/migrate.ts`)
- Socket.IO authentication middleware
- argon2, better-sqlite3, sharp dependencies (none are needed in M1)

If a step in this M1 plan seems to drift toward any of these, stop and revisit — it doesn't belong here.
