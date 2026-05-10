import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/src/db/migrate.js';
import { insertAsset } from '../server/src/db/assets.js';
import { createPage, setActivePage } from '../server/src/db/pages.js';
import { insertFogStroke } from '../server/src/db/fog-strokes.js';
import {
  buildFullSync,
  fogPayloadFor,
  fogStrokeToPayload,
} from '../server/src/broadcast.js';
import { createPresence } from '../server/src/presence.js';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, 'migrations');
  const m = insertAsset(db, {
    hash: 'm', kind: 'map', originalName: 'm.png', mime: 'image/webp',
    width: 1000, height: 800, sizeBytes: 1,
  });
  const active = createPage(db, {
    name: 'A', backgroundAssetId: m.id, gridWidthSquares: 10, gridHeightSquares: 8,
  });
  const inactive = createPage(db, {
    name: 'B', backgroundAssetId: m.id, gridWidthSquares: 10, gridHeightSquares: 8,
  });
  setActivePage(db, active.id);
  return { db, activeId: active.id, inactiveId: inactive.id };
}

describe('fogStrokeToPayload', () => {
  it('shapes a stroke for the wire (snake_case)', () => {
    const f = setup();
    const s = insertFogStroke(f.db, {
      pageId: f.activeId, mode: 'reveal', shape: 'brush',
      points: [[1, 2]], radius: 10,
    });
    const p = fogStrokeToPayload(s);
    expect(p).toEqual({
      id: s.id,
      page_id: f.activeId,
      mode: 'reveal',
      shape: 'brush',
      points: [[1, 2]],
      radius: 10,
      created_at: s.createdAt,
    });
  });
});

describe('fogPayloadFor', () => {
  const dm = { data: { role: 'dm' as const, name: 'DM', playerId: null } };
  const player = { data: { role: 'player' as const, name: 'A', playerId: 1 } };

  it('DM always receives', () => {
    expect(fogPayloadFor(dm, { page_id: 99 } as never, 5)).toEqual({ page_id: 99 });
  });

  it('player on active page receives', () => {
    expect(fogPayloadFor(player, { page_id: 5 } as never, 5)).toEqual({ page_id: 5 });
  });

  it('player on non-active page is filtered to null', () => {
    expect(fogPayloadFor(player, { page_id: 99 } as never, 5)).toBeNull();
  });

  it('player when no active page is filtered to null', () => {
    expect(fogPayloadFor(player, { page_id: 5 } as never, null)).toBeNull();
  });
});

describe('buildFullSync.strokes', () => {
  it('includes strokes for the active page in DM full sync', () => {
    const f = setup();
    insertFogStroke(f.db, {
      pageId: f.activeId, mode: 'reveal', shape: 'brush', points: [[5, 5]], radius: 20,
    });
    insertFogStroke(f.db, {
      pageId: f.inactiveId, mode: 'reveal', shape: 'brush', points: [[1, 1]], radius: 10,
    });
    const sync = buildFullSync(f.db, { data: { role: 'dm', name: 'DM', playerId: null } }, createPresence());
    expect(sync.activePage).not.toBeNull();
    expect(sync.activePage!.strokes).toHaveLength(1);
    expect(sync.activePage!.strokes![0]).toMatchObject({
      page_id: f.activeId, mode: 'reveal', shape: 'brush', radius: 20,
    });
  });

  it('includes strokes for the active page in player full sync', () => {
    const f = setup();
    insertFogStroke(f.db, {
      pageId: f.activeId, mode: 'reveal', shape: 'brush', points: [[5, 5]], radius: 20,
    });
    const sync = buildFullSync(f.db, {
      data: { role: 'player', name: 'A', playerId: 1 },
    }, createPresence());
    expect(sync.activePage!.strokes).toHaveLength(1);
  });

  it('returns empty strokes array when no strokes exist', () => {
    const f = setup();
    const sync = buildFullSync(f.db, { data: { role: 'dm', name: 'DM', playerId: null } }, createPresence());
    expect(sync.activePage!.strokes).toEqual([]);
  });
});
