import { describe, it, expect } from 'vitest';
import { buildFogBitmap } from './fogBitmap.js';
import type { FogStroke } from '../api.js';

function strokeAt(
  o: Partial<FogStroke> & Pick<FogStroke, 'points' | 'mode' | 'shape'>,
): FogStroke {
  return {
    id: 1, page_id: 1, radius: 0, created_at: 0, ...o,
  };
}

function pixel(c: HTMLCanvasElement, x: number, y: number): [number, number, number, number] {
  const ctx = c.getContext('2d')!;
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

describe('buildFogBitmap', () => {
  it('empty stroke list yields a fully black canvas (alpha=255)', () => {
    const c = buildFogBitmap(50, 50, []);
    expect(c.width).toBe(50);
    expect(c.height).toBe(50);
    expect(pixel(c, 25, 25)).toEqual([0, 0, 0, 255]);
    expect(pixel(c, 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it('a single reveal disc punches a transparent hole at its center', () => {
    const c = buildFogBitmap(100, 100, [
      strokeAt({
        mode: 'reveal', shape: 'brush', points: [[50, 50]], radius: 20,
      }),
    ]);
    // Center of disc: alpha=0 (transparent).
    const [, , , aCenter] = pixel(c, 50, 50);
    expect(aCenter).toBe(0);
    // Far corner: still fogged (alpha=255).
    const [, , , aCorner] = pixel(c, 5, 5);
    expect(aCorner).toBe(255);
  });

  it('a hide stroke after a reveal at the same spot re-fogs it', () => {
    const c = buildFogBitmap(100, 100, [
      strokeAt({ mode: 'reveal', shape: 'brush', points: [[50, 50]], radius: 20 }),
      strokeAt({ id: 2, mode: 'hide', shape: 'brush', points: [[50, 50]], radius: 20 }),
    ]);
    expect(pixel(c, 50, 50)[3]).toBe(255);
  });

  it('reveal rect creates a transparent rectangle', () => {
    const c = buildFogBitmap(100, 100, [
      strokeAt({
        mode: 'reveal', shape: 'rect', points: [[10, 10], [40, 40]], radius: 0,
      }),
    ]);
    expect(pixel(c, 25, 25)[3]).toBe(0);   // inside
    expect(pixel(c, 80, 80)[3]).toBe(255); // outside
  });

  it('multi-point brush draws a connected polyline', () => {
    const c = buildFogBitmap(200, 50, [
      strokeAt({
        mode: 'reveal', shape: 'brush',
        points: [[10, 25], [190, 25]], radius: 10,
      }),
    ]);
    // Anywhere along the line center: revealed.
    expect(pixel(c, 100, 25)[3]).toBe(0);
    expect(pixel(c, 50, 25)[3]).toBe(0);
    // Above/below brush radius: fogged.
    expect(pixel(c, 100, 0)[3]).toBe(255);
  });
});
