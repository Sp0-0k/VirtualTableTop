import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database, migrationsDir: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    db
      .prepare('SELECT filename FROM _migrations')
      .all()
      .map((r) => (r as { filename: string }).filename),
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const recordApplied = db.prepare(
    'INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)',
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      recordApplied.run(file, Date.now());
    });
    apply();
    console.log(`[migrate] applied ${file}`);
  }
}
