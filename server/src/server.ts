import express from 'express';
import http from 'node:http';
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
