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
