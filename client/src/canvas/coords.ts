import type Konva from 'konva';

/**
 * Convert a screen-space point (e.g. drag-and-drop drop coordinate, relative
 * to the Stage container) to world-space (image pixels).
 */
export function stageToWorld(
  stage: Konva.Stage,
  point: { x: number; y: number },
): { x: number; y: number } {
  const t = stage.getAbsoluteTransform().copy().invert();
  const p = t.point(point);
  return { x: p.x, y: p.y };
}

export function snap(value: number, cell: number): number {
  return Math.round(value / cell) * cell + cell / 2;
}

export function snapPoint(
  p: { x: number; y: number },
  cellW: number,
  cellH: number,
): { x: number; y: number } {
  return { x: snap(p.x, cellW), y: snap(p.y, cellH) };
}
