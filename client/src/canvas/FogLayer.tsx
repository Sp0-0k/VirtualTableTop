import { useMemo } from 'react';
import { Image as KImage, Layer } from 'react-konva';
import type { FogStroke } from '../api.js';
import { buildFogBitmap } from './fogBitmap.js';

interface Props {
  imageW: number;
  imageH: number;
  strokes: FogStroke[];
  inProgress: FogStroke | null;
  role: 'dm' | 'player';
}

export function FogLayer({ imageW, imageH, strokes, inProgress, role }: Props) {
  const all: FogStroke[] = useMemo(
    () => (inProgress ? [...strokes, inProgress] : strokes),
    [strokes, inProgress],
  );
  const bitmap = useMemo(() => {
    if (imageW <= 0 || imageH <= 0) return null;
    return buildFogBitmap(imageW, imageH, all);
  }, [imageW, imageH, all]);

  if (!bitmap) return null;

  return (
    <Layer opacity={role === 'dm' ? 0.5 : 1.0} listening={false}>
      <KImage image={bitmap} x={0} y={0} width={imageW} height={imageH} />
    </Layer>
  );
}
