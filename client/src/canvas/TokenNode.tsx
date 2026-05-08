import { useEffect, useRef, useState } from 'react';
import { Circle, Group, Image as KImage, Text } from 'react-konva';
import type Konva from 'konva';
import type { Token, Player } from '../api.js';

const DM_COLOR = '#888888';
const UNOWNED_COLOR = '#bbbbbb';

interface Props {
  token: Token;
  cellW: number;
  cellH: number;
  draggable: boolean;
  selected: boolean;
  player?: Player;
  liveX?: number;
  liveY?: number;
  onSelect?: (id: number) => void;
  onDragMove?: (id: number, x: number, y: number) => void;
  onDragEnd?: (id: number, x: number, y: number, altKey: boolean) => void;
}

export function TokenNode({
  token, cellW, cellH, draggable, selected, player, liveX, liveY,
  onSelect, onDragMove, onDragEnd,
}: Props) {
  const groupRef = useRef<Konva.Group>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const i = new window.Image();
    i.crossOrigin = 'anonymous';
    i.src = token.asset_url;
    i.onload = () => setImg(i);
  }, [token.asset_url]);

  const w = cellW * token.size_squares;
  const h = cellH * token.size_squares;
  const x = liveX ?? token.x;
  const y = liveY ?? token.y;

  const ringColor =
    token.owner_player_id === null ? UNOWNED_COLOR : (player?.color ?? DM_COLOR);
  const ringDash =
    token.owner_player_id === null ? [6, 6] : undefined;

  return (
    <Group
      id={`token-${token.id}`}
      ref={groupRef}
      x={x} y={y}
      draggable={draggable}
      onMouseDown={(e) => { e.cancelBubble = true; onSelect?.(token.id); }}
      onDragMove={(e) => onDragMove?.(token.id, e.target.x(), e.target.y())}
      onDragEnd={(e) => onDragEnd?.(token.id, e.target.x(), e.target.y(),
        (e.evt as MouseEvent).altKey)}
    >
      {img && (
        <KImage image={img} x={-w / 2} y={-h / 2} width={w} height={h} />
      )}
      <Circle
        x={0} y={0} radius={Math.max(w, h) / 2 + 3}
        stroke={ringColor} dash={ringDash}
        strokeWidth={selected ? 4 : 2}
      />
      {token.name && (
        <Text
          text={token.name}
          x={-w / 2} y={h / 2 + 4} width={w} align="center"
          fontSize={12} fill="#fff"
          shadowColor="#000" shadowBlur={2} shadowOpacity={1}
        />
      )}
    </Group>
  );
}
