import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  assetPath,
  atomicWrite,
  ensureUploadsDir,
  getUploadsDir,
  thumbPath,
  totalUploadsBytes,
} from '../server/src/assets/storage.js';

describe('storage helpers', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-storage-test-'));
    process.env.UPLOADS_DIR = dir;
  });

  it('getUploadsDir returns the env var', () => {
    expect(getUploadsDir()).toBe(dir);
  });

  it('ensureUploadsDir is idempotent', () => {
    ensureUploadsDir();
    ensureUploadsDir();
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('assetPath/thumbPath build hash-based filenames', () => {
    expect(assetPath('abc')).toBe(path.join(dir, 'abc.webp'));
    expect(thumbPath('abc')).toBe(path.join(dir, 'abc.thumb.webp'));
  });

  it('atomicWrite writes the file and leaves no .tmp behind', async () => {
    const target = assetPath('x');
    await atomicWrite(target, Buffer.from('hello'));
    expect(fs.readFileSync(target).toString()).toBe('hello');
    const leftover = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.tmp'));
    expect(leftover).toEqual([]);
  });

  it('totalUploadsBytes sums file sizes in the dir', async () => {
    await atomicWrite(assetPath('a'), Buffer.alloc(100));
    await atomicWrite(assetPath('b'), Buffer.alloc(250));
    expect(totalUploadsBytes()).toBe(350);
  });

  it('totalUploadsBytes returns 0 for a missing dir', () => {
    fs.rmSync(dir, { recursive: true });
    expect(totalUploadsBytes()).toBe(0);
  });
});
