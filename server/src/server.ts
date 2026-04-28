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

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] === thisFile) {
  const server = createServer();
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    console.log(`vtt server listening on :${port}`);
  });
}
