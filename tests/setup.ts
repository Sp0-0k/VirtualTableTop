// Set required env vars before any module imports them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.APP_SECRET = 'test-secret-do-not-use-in-prod';
// Make sure COOKIE_SECURE doesn't leak in from the operator's shell — tests
// need to control it explicitly.
delete process.env.COOKIE_SECURE;

// Per-worker tmpdir for asset uploads. Vitest runs each test file in its own
// worker process, so this is isolated per-file.
const uploadsTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-uploads-'));
process.env.UPLOADS_DIR = uploadsTmp;
