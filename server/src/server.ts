import express from 'express';
import http from 'node:http';
import type Database from 'better-sqlite3';
import healthRouter from './routes/health.js';
import { dmRouter } from './routes/dm.js';
import { dmAssetsRouter } from './routes/dm-assets.js';
import { dmPagesRouter } from './routes/dm-pages.js';
import { dmTokensRouter } from './routes/dm-tokens.js';
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
  app.use('/api/dm/tokens', dmTokensRouter({ db: deps.db, io }));
  app.use('/api', playerRouter(deps.db));

  return httpServer;
}
