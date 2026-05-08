import type Konva from 'konva';

const SCALE_BY = 1.1;
const MIN = 0.1;
const MAX = 8;

export function zoomAtCursor(stage: Konva.Stage, deltaY: number): void {
  const oldScale = stage.scaleX();
  const pointer = stage.getPointerPosition();
  if (!pointer) return;
  const mousePointTo = {
    x: (pointer.x - stage.x()) / oldScale,
    y: (pointer.y - stage.y()) / oldScale,
  };
  const raw = deltaY > 0 ? oldScale / SCALE_BY : oldScale * SCALE_BY;
  const newScale = Math.max(MIN, Math.min(MAX, raw));
  stage.scale({ x: newScale, y: newScale });
  stage.position({
    x: pointer.x - mousePointTo.x * newScale,
    y: pointer.y - mousePointTo.y * newScale,
  });
  stage.batchDraw();
}
