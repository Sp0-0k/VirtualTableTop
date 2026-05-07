import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const MAX_UPLOADS_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB sanity ceiling

export function getUploadsDir(): string {
  return process.env.UPLOADS_DIR ?? path.resolve('uploads');
}

export function ensureUploadsDir(dir = getUploadsDir()): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function assetPath(hash: string, dir = getUploadsDir()): string {
  return path.join(dir, `${hash}.webp`);
}

export function thumbPath(hash: string, dir = getUploadsDir()): string {
  return path.join(dir, `${hash}.thumb.webp`);
}

export async function atomicWrite(targetPath: string, bytes: Buffer): Promise<void> {
  const tmp = `${targetPath}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.promises.writeFile(tmp, bytes);
  await fs.promises.rename(tmp, targetPath);
}

export function totalUploadsBytes(dir = getUploadsDir()): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      total += fs.statSync(path.join(dir, entry.name)).size;
    }
  }
  return total;
}
