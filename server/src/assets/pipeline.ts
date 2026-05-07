import crypto from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

export const ALLOWED_MIMES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
export const MAX_INPUT_DIMENSION = 8192;
export const MAP_MAX_LONGEST_EDGE = 4096;
export const TOKEN_MAX_DIMENSION = 512;
export const THUMB_MAP = 256;
export const THUMB_TOKEN = 128;

export type AssetKind = 'map' | 'token';

export type PipelineErrorCode = 'UNSUPPORTED_MIME' | 'OVERSIZE';

export class PipelineError extends Error {
  constructor(
    public readonly code: PipelineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

export interface ProcessResult {
  hash: string;
  processed: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  mime: 'image/webp';
}

export async function processImage(buffer: Buffer, kind: AssetKind): Promise<ProcessResult> {
  const sniff = await fileTypeFromBuffer(buffer);
  if (!sniff || !ALLOWED_MIMES.has(sniff.mime)) {
    throw new PipelineError('UNSUPPORTED_MIME', `unsupported mime: ${sniff?.mime ?? 'unknown'}`);
  }

  const meta = await sharp(buffer).metadata();
  if (
    !meta.width ||
    !meta.height ||
    meta.width > MAX_INPUT_DIMENSION ||
    meta.height > MAX_INPUT_DIMENSION
  ) {
    throw new PipelineError('OVERSIZE', `input dimensions exceed ${MAX_INPUT_DIMENSION}px`);
  }

  const longest = kind === 'map' ? MAP_MAX_LONGEST_EDGE : TOKEN_MAX_DIMENSION;
  const thumbDim = kind === 'map' ? THUMB_MAP : THUMB_TOKEN;

  const processed = await sharp(buffer)
    .resize({ width: longest, height: longest, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();

  const processedMeta = await sharp(processed).metadata();
  if (!processedMeta.width || !processedMeta.height) {
    throw new PipelineError('UNSUPPORTED_MIME', 'failed to read processed dimensions');
  }

  const thumb = await sharp(buffer)
    .resize({ width: thumbDim, height: thumbDim, fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer();

  const hash = crypto.createHash('sha256').update(processed).digest('hex');

  return {
    hash,
    processed,
    thumb,
    width: processedMeta.width,
    height: processedMeta.height,
    mime: 'image/webp',
  };
}
