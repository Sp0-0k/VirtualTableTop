import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { getUploadsDir } from '../assets/storage.js';

export interface TestResetDeps {
  db: Database.Database;
}

export function testResetRouter(deps: TestResetDeps): Router {
  const r = Router();

  r.post('/reset', (_req, res) => {
    deps.db.exec(`
      DELETE FROM fog_strokes;
      DELETE FROM tokens;
      DELETE FROM walls;
      DELETE FROM pages;
      DELETE FROM assets;
      DELETE FROM players;
      DELETE FROM sqlite_sequence;
    `);
    const dir = getUploadsDir();
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.webp')) {
          try {
            fs.unlinkSync(path.join(dir, f));
          } catch {
            /* ignore */
          }
        }
      }
    }
    res.status(204).end();
  });

  return r;
}
