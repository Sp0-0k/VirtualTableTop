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
