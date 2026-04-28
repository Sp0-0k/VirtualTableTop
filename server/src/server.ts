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

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] === thisFile) {
  const server = createServer();
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    console.log(`vtt server listening on :${port}`);
  });
}
