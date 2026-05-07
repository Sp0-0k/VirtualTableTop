import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { PipelineError, processImage } from '../server/src/assets/pipeline.js';

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
}

describe('processImage (map kind)', () => {
  it('normalizes a small PNG into WebP and returns metadata', async () => {
    const png = await makePng(300, 200);
    const result = await processImage(png, 'map');
    expect(result.mime).toBe('image/webp');
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
    expect(result.processed.length).toBeGreaterThan(0);
    expect(result.thumb.length).toBeGreaterThan(0);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces an identical hash for identical input', async () => {
    const png = await makePng(64, 64);
    const a = await processImage(png, 'map');
    const b = await processImage(png, 'map');
    expect(a.hash).toBe(b.hash);
  });

  it('downscales maps larger than 4096px on the longest edge', async () => {
    const png = await makePng(6000, 3000);
    const result = await processImage(png, 'map');
    expect(result.width).toBe(4096);
    expect(result.height).toBe(2048);
  });

  it('rejects images whose input dimensions exceed 8192px', async () => {
    const png = await makePng(8200, 100);
    await expect(processImage(png, 'map')).rejects.toThrow(PipelineError);
  });

  it('rejects non-image bytes', async () => {
    const garbage = Buffer.from('not an image at all');
    await expect(processImage(garbage, 'map')).rejects.toThrow(PipelineError);
  });
});
