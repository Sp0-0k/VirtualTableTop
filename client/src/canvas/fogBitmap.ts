import type { FogStroke } from '../api.js';

export function buildFogBitmap(
  w: number,
  h: number,
  strokes: FogStroke[],
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(w));
  c.height = Math.max(1, Math.floor(h));
  const ctx = c.getContext('2d');
  if (!ctx) return c;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);

  for (const s of strokes) {
    ctx.globalCompositeOperation =
      s.mode === 'reveal' ? 'destination-out' : 'source-over';
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';

    if (s.shape === 'rect') {
      const [[x1, y1], [x2, y2]] = s.points;
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      continue;
    }

    // brush
    const r = Math.max(0.5, s.radius);
    if (s.points.length === 1) {
      const [[x, y]] = s.points;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineWidth = r * 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(s.points[0][0], s.points[0][1]);
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i][0], s.points[i][1]);
      }
      ctx.stroke();
    }
  }

  ctx.globalCompositeOperation = 'source-over';
  return c;
}
