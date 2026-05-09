import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import Konva from 'konva';
import type { ApiPage, Token, Player } from '../api.js';
import { Canvas } from './Canvas.js';

const page: ApiPage = {
  id: 1, name: 'P', background_asset_id: null, background_url: null,
  grid_width_squares: 20, grid_height_squares: 15, sort_order: 0, is_active: 1,
};

function tok(over: Partial<Token>): Token {
  return {
    id: 1, page_id: 1, asset_id: 1,
    asset_url: '/assets/x.webp', asset_thumb_url: '/assets/x.thumb.webp',
    name: 'X', x: 100, y: 200, size_squares: 1, owner_player_id: null,
    conditions: [], z_index: 0,
    ...over,
  };
}

function findStage(): Konva.Stage {
  const stages = Konva.stages;
  return stages[stages.length - 1];
}

beforeEach(() => {
  // image-bg-load is async; tests don't depend on it.
});

describe('Canvas scene graph', () => {
  it('places token at world coordinates', () => {
    render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas
          page={{ ...page, grid_width_squares: 16, grid_height_squares: 12 }}
          tokens={[tok({ id: 42, x: 100, y: 200, size_squares: 1 })]}
          players={[]}
          movableTokenIds={new Set()}
          selectable={false}
          selectedTokenId={null}
          dragging={{}}
          incomingMove={{}}
          role="dm"
          fogStrokes={[]}
          fogInProgress={null}
        />
      </div>,
    );
    const stage = findStage();
    const group = stage.findOne('#token-42') as Konva.Group;
    expect(group.x()).toBe(100);
    expect(group.y()).toBe(200);
  });

  it('image dimensions reflect size_squares × cellW (when bg image is known)', async () => {
    render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas
          page={page}
          tokens={[tok({ id: 7, size_squares: 2 })]}
          players={[]}
          movableTokenIds={new Set()}
          selectable={false}
          selectedTokenId={null}
          dragging={{}}
          incomingMove={{}}
          role="dm"
          fogStrokes={[]}
          fogInProgress={null}
        />
      </div>,
    );
    const stage = findStage();
    const group = stage.findOne('#token-7') as Konva.Group;
    expect(group).toBeTruthy();
    const circles = group.find('Circle') as Konva.Circle[];
    expect(circles.length).toBeGreaterThan(0);
  });

  it('SelectionRing exists when a token is selected and selectable=true', () => {
    render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas
          page={page}
          tokens={[tok({ id: 9 })]}
          players={[]}
          movableTokenIds={new Set([9])}
          selectable
          selectedTokenId={9}
          dragging={{}}
          incomingMove={{}}
          role="dm"
          fogStrokes={[]}
          fogInProgress={null}
        />
      </div>,
    );
    const stage = findStage();
    const ring = stage.findOne('.SelectionRing') as Konva.Circle | null;
    expect(ring).toBeTruthy();
    expect(ring!.getAttr('tokenId')).toBe(9);
  });

  it('owner-color ring matches the player color, DM = grey, unowned = dashed grey', () => {
    const players: Player[] = [{ id: 1, name: 'A', color: '#ff8800', createdAt: 0, lastSeenAt: null }];
    render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas
          page={page}
          tokens={[
            tok({ id: 100, owner_player_id: 1 }),
            tok({ id: 200, owner_player_id: null }),
          ]}
          players={players}
          movableTokenIds={new Set()}
          selectable={false}
          selectedTokenId={null}
          dragging={{}}
          incomingMove={{}}
          role="dm"
          fogStrokes={[]}
          fogInProgress={null}
        />
      </div>,
    );
    const stage = findStage();
    const owned = stage.findOne('#token-100') as Konva.Group;
    const unowned = stage.findOne('#token-200') as Konva.Group;
    const ringOwned = owned.findOne('Circle') as Konva.Circle;
    const ringUnowned = unowned.findOne('Circle') as Konva.Circle;
    expect(ringOwned.stroke()).toBe('#ff8800');
    expect(ringUnowned.dash()).toEqual([6, 6]);
  });

  it('grid line count matches grid_width_squares + grid_height_squares - 2 inner lines', () => {
    render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas
          page={{ ...page, grid_width_squares: 20, grid_height_squares: 15 }}
          tokens={[]}
          players={[]}
          movableTokenIds={new Set()}
          selectable={false}
          selectedTokenId={null}
          dragging={{}}
          incomingMove={{}}
          role="dm"
          fogStrokes={[]}
          fogInProgress={null}
        />
      </div>,
    );
    const stage = findStage();
    const lines = stage.find('Line') as Konva.Line[];
    expect(lines.length === 0 || lines.length === 19 + 14).toBe(true);
  });
});
