import { useEffect, useRef, useState } from 'react';
import { Image as KImage, Layer, Stage } from 'react-konva';
import type Konva from 'konva';
import type { ApiPage, Token, Player } from '../api.js';
import { GridLines } from './GridLines.js';
import { TokenNode } from './TokenNode.js';
import { SelectionRing } from './SelectionRing.js';
import { stageToWorld, snapPoint } from './coords.js';
import { zoomAtCursor } from './zoom.js';

interface Props {
  page: ApiPage;
  tokens: Token[];
  players: Player[];
  movableTokenIds: Set<number>;
  selectable: boolean;
  selectedTokenId: number | null;
  dragging: Record<number, { x: number; y: number }>;
  incomingMove: Record<number, { x: number; y: number }>;
  onSelect?: (id: number | null) => void;
  onDropAsset?: (assetId: number, world: { x: number; y: number }) => void;
  onMovePreview?: (id: number, x: number, y: number) => void;
  onMoveCommit?: (id: number, x: number, y: number) => void;
}

export function Canvas({
  page, tokens, players, movableTokenIds, selectable, selectedTokenId,
  dragging, incomingMove, onSelect, onDropAsset, onMovePreview, onMoveCommit,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [bg, setBg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!page.background_url) { setBg(null); return; }
    const i = new window.Image();
    i.crossOrigin = 'anonymous';
    i.src = page.background_url;
    i.onload = () => setBg(i);
  }, [page.background_url]);

  const imgW = bg?.naturalWidth ?? 0;
  const imgH = bg?.naturalHeight ?? 0;
  const cellW = imgW > 0 ? imgW / page.grid_width_squares : 50;
  const cellH = imgH > 0 ? imgH / page.grid_height_squares : 50;

  const playersById = new Map(players.map((p) => [p.id, p]));

  const previewQueued = useRef<{ id: number; x: number; y: number } | null>(null);
  const rafScheduled = useRef(false);
  function emitPreview(id: number, x: number, y: number) {
    previewQueued.current = { id, x, y };
    if (rafScheduled.current) return;
    rafScheduled.current = true;
    requestAnimationFrame(() => {
      rafScheduled.current = false;
      const p = previewQueued.current;
      previewQueued.current = null;
      if (p && onMovePreview) onMovePreview(p.id, p.x, p.y);
    });
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#222' }}
      onDragOver={onDropAsset ? (e) => e.preventDefault() : undefined}
      onDrop={onDropAsset ? (e) => {
        e.preventDefault();
        const assetId = Number(e.dataTransfer.getData('application/x-vtt-asset'));
        if (!Number.isInteger(assetId) || !stageRef.current) return;
        const rect = containerRef.current!.getBoundingClientRect();
        const world = stageToWorld(stageRef.current, {
          x: e.clientX - rect.left, y: e.clientY - rect.top,
        });
        onDropAsset(assetId, world);
      } : undefined}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        draggable
        onWheel={(e) => { e.evt.preventDefault(); if (stageRef.current) zoomAtCursor(stageRef.current, e.evt.deltaY); }}
        onMouseDown={(e) => {
          if (selectable && e.target === e.target.getStage()) onSelect?.(null);
        }}
      >
        <Layer listening={false}>
          {bg && <KImage image={bg} x={0} y={0} width={imgW} height={imgH} />}
        </Layer>
        <Layer listening={false}>
          {imgW > 0 && (
            <GridLines
              imageWidth={imgW} imageHeight={imgH}
              gridWidthSquares={page.grid_width_squares}
              gridHeightSquares={page.grid_height_squares}
            />
          )}
        </Layer>
        <Layer>
          {tokens.map((t) => {
            const drag = dragging[t.id];
            const incoming = incomingMove[t.id];
            const liveX = drag?.x ?? incoming?.x;
            const liveY = drag?.y ?? incoming?.y;
            return (
              <TokenNode
                key={t.id}
                token={t}
                cellW={cellW}
                cellH={cellH}
                draggable={movableTokenIds.has(t.id)}
                selected={selectable && selectedTokenId === t.id}
                player={t.owner_player_id ? playersById.get(t.owner_player_id) : undefined}
                liveX={liveX}
                liveY={liveY}
                onSelect={selectable ? (id) => onSelect?.(id) : undefined}
                onDragMove={(id, x, y) => emitPreview(id, x, y)}
                onDragEnd={(id, x, y, alt) => {
                  const p = alt ? { x, y } : snapPoint({ x, y }, cellW, cellH);
                  onMoveCommit?.(id, p.x, p.y);
                }}
              />
            );
          })}
        </Layer>
        <Layer listening={false}>
          {selectable && selectedTokenId !== null && tokens.find((t) => t.id === selectedTokenId) && (
            <SelectionRing
              token={tokens.find((t) => t.id === selectedTokenId)!}
              cellW={cellW}
              cellH={cellH}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
