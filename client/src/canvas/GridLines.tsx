import { memo, useMemo } from 'react';
import { Group, Line, Rect } from 'react-konva';

interface Props {
  imageWidth: number;
  imageHeight: number;
  gridWidthSquares: number;
  gridHeightSquares: number;
}

function GridLinesImpl({ imageWidth, imageHeight, gridWidthSquares, gridHeightSquares }: Props) {
  const lines = useMemo(() => {
    const cellW = imageWidth / gridWidthSquares;
    const cellH = imageHeight / gridHeightSquares;
    const out: { points: number[]; key: string }[] = [];
    for (let i = 1; i < gridWidthSquares; i += 1) {
      const x = i * cellW;
      out.push({ points: [x, 0, x, imageHeight], key: `v${i}` });
    }
    for (let j = 1; j < gridHeightSquares; j += 1) {
      const y = j * cellH;
      out.push({ points: [0, y, imageWidth, y], key: `h${j}` });
    }
    return out;
  }, [imageWidth, imageHeight, gridWidthSquares, gridHeightSquares]);
  return (
    <Group>
      <Rect x={0} y={0} width={imageWidth} height={imageHeight}
            stroke="rgba(0,0,0,0.4)" strokeWidth={2} listening={false} />
      {lines.map((l) => (
        <Line key={l.key} points={l.points} stroke="rgba(0,0,0,0.2)" strokeWidth={1} listening={false} />
      ))}
    </Group>
  );
}

export const GridLines = memo(GridLinesImpl);
