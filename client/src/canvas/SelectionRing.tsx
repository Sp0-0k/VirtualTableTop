import { Circle } from 'react-konva';
import type { Token } from '../api.js';

interface Props {
  token: Token;
  cellW: number;
  cellH: number;
}

export function SelectionRing({ token, cellW, cellH }: Props) {
  const w = cellW * token.size_squares;
  const h = cellH * token.size_squares;
  return (
    <Circle
      name="SelectionRing"
      x={token.x} y={token.y}
      radius={Math.max(w, h) / 2 + 8}
      stroke="#ffd54a" strokeWidth={3} dash={[4, 4]}
      listening={false}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...({ tokenId: token.id } as any)}
    />
  );
}
