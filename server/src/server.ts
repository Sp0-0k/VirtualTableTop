import express from 'express';
import http from 'node:http';
import type Database from 'better-sqlite3';
import healthRouter from './routes/health.js';
import { dmRouter } from './routes/dm.js';
import { playerRouter } from './routes/player.js';
import { attachSocketIO } from './socket.js';

export interface ServerDeps {
  db: Database.Database;
}

export function createServer(deps: ServerDeps): http.Server {
  const app = express();

  app.use(express.json());
  app.use('/api/health', healthRouter);
  app.use('/api/dm', dmRouter());
  app.use('/api', playerRouter(deps.db));

  const httpServer = http.createServer(app);
  attachSocketIO(httpServer, deps);

  return httpServer;
}
