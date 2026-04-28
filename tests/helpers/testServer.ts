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
