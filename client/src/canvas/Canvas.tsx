import { useEffect, useRef, useState } from 'react';
import { Image as KImage, Layer, Stage } from 'react-konva';
import type Konva from 'konva';
import type { ApiPage, Token, Player, FogStroke } from '../api.js';
import { GridLines } from './GridLines.js';
import { TokenNode } from './TokenNode.js';
import { SelectionRing } from './SelectionRing.js';
import { FogLayer } from './FogLayer.js';
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
  // Fog props
  role: 'dm' | 'player';
  fogStrokes: FogStroke[];
  fogInProgress: FogStroke | null;
  fogTool?: {
    mode: 'reveal' | 'hide';
    shape: 'brush' | 'rect';
    radius: number;
  };
  // Fog callbacks (DM only; pass undefined on player view)
  onFogStrokeUpdate?: (s: FogStroke | null) => void;
  onFogPreview?: (s: FogStroke) => void;
  onFogCommit?: (s: FogStroke) => void;
  // Existing callbacks
  onSelect?: (id: number | null) => void;
  onDropAsset?: (assetId: number, world: { x: number; y: number }) => void;
  onMovePreview?: (id: number, x: number, y: number) => void;
  onMoveCommit?: (id: number, x: number, y: number) => void;
}

export function Canvas({
  page, tokens, players, movableTokenIds, selectable, selectedTokenId,
  dragging, incomingMove,
  role, fogStrokes, fogInProgress, fogTool,
  onFogStrokeUpdate, onFogPreview, onFogCommit,
  onSelect, onDropAsset, onMovePreview, onMoveCommit,
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

  const fogPainting = useRef(false);
  const fogQueued = useRef<FogStroke | null>(null);
  const fogRafScheduled = useRef(false);
  function emitFogPreview(s: FogStroke) {
    fogQueued.current = s;
    if (fogRafScheduled.current) return;
    fogRafScheduled.current = true;
    requestAnimationFrame(() => {
      fogRafScheduled.current = false;
      const queued = fogQueued.current;
      fogQueued.current = null;
      if (queued && onFogPreview) onFogPreview(queued);
    });
  }

  const fogActive = role === 'dm' && !!fogTool && !!onFogStrokeUpdate;

  function startFogStroke(world: { x: number; y: number }) {
    if (!fogTool) return;
    fogPainting.current = true;
    const seed: FogStroke = {
      id: -1,
      page_id: page.id,
      mode: fogTool.mode,
      shape: fogTool.shape,
      points: [[world.x, world.y]],
      radius: fogTool.shape === 'brush' ? fogTool.radius : 0,
      created_at: Date.now(),
    };
    onFogStrokeUpdate?.(seed);
    emitFogPreview(seed);
  }

  function extendFogStroke(world: { x: number; y: number }) {
    if (!fogPainting.current || !fogInProgress) return;
    if (fogInProgress.shape === 'rect') {
      // Rect: second corner follows the cursor.
      const next: FogStroke = {
        ...fogInProgress,
        points: [fogInProgress.points[0], [world.x, world.y]],
      };
      onFogStrokeUpdate?.(next);
      emitFogPreview(next);
      return;
    }
    // Brush: decimate (skip points within 2 image-px of last).
    const last = fogInProgress.points[fogInProgress.points.length - 1];
    const dx = world.x - last[0], dy = world.y - last[1];
    if (dx * dx + dy * dy < 4) return;
    const next: FogStroke = {
      ...fogInProgress,
      points: [...fogInProgress.points, [world.x, world.y]],
    };
    onFogStrokeUpdate?.(next);
    emitFogPreview(next);
  }

  function commitFogStroke() {
    if (!fogPainting.current || !fogInProgress) return;
    fogPainting.current = false;
    if (fogInProgress.shape === 'rect') {
      const [a, b] = fogInProgress.points;
      if (a[0] === b[0] || a[1] === b[1]) {
        // Zero-area: discard.
        onFogStrokeUpdate?.(null);
        return;
      }
    }
    onFogCommit?.(fogInProgress);
  }

  function abortFogStroke() {
    fogPainting.current = false;
    onFogStrokeUpdate?.(null);
  }

  useEffect(() => {
    if (!fogActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fogPainting.current) abortFogStroke();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // abortFogStroke closes over current onFogStrokeUpdate; rebind on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fogActive, onFogStrokeUpdate]);

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
        draggable={!fogActive}
        onWheel={(e) => { e.evt.preventDefault(); if (stageRef.current) zoomAtCursor(stageRef.current, e.evt.deltaY); }}
        onMouseDown={(e) => {
          if (fogActive) {
            // Only start a fog stroke for left-click on the stage itself.
            if (e.evt.button !== 0) return;
            const stage = stageRef.current;
            if (!stage) return;
            const pointer = stage.getPointerPosition();
            if (!pointer) return;
            const world = stageToWorld(stage, pointer);
            startFogStroke(world);
            return;
          }
          if (selectable && e.target === e.target.getStage()) onSelect?.(null);
        }}
        onMouseMove={() => {
          if (!fogActive || !fogPainting.current) return;
          const stage = stageRef.current;
          if (!stage) return;
          const pointer = stage.getPointerPosition();
          if (!pointer) return;
          extendFogStroke(stageToWorld(stage, pointer));
        }}
        onMouseUp={() => { if (fogActive) commitFogStroke(); }}
        onContextMenu={(e) => {
          if (fogActive && fogPainting.current) {
            e.evt.preventDefault();
            abortFogStroke();
          }
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
        <Layer listening={!fogActive}>
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
        {imgW > 0 && (
          <FogLayer
            imageW={imgW}
            imageH={imgH}
            strokes={fogStrokes}
            inProgress={fogInProgress}
            role={role}
          />
        )}
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
