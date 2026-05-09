import type Database from 'better-sqlite3';
import type { Socket } from 'socket.io';
import { broadcastFogEvent, fogStrokeToPayload } from '../broadcast.js';
import { findAssetById } from '../db/assets.js';
import { findActivePage, findPageById } from '../db/pages.js';
import {
  insertFogStroke,
  validateAndNormalizeStroke,
} from '../db/fog-strokes.js';
import type { SessionData } from '../socket.js';

interface RawStrokePayload {
  pageId: unknown;
  mode: unknown;
  shape: unknown;
  points: unknown;
  radius: unknown;
}

interface ParsedPayload {
  pageId: number;
  mode: 'reveal' | 'hide';
  shape: 'brush' | 'rect';
  points: [number, number][];
  radius: number;
}

function parseRaw(p: RawStrokePayload): ParsedPayload | null {
  const pageId = Number(p.pageId);
  const radius = Number(p.radius);
  if (!Number.isInteger(pageId) || !Number.isFinite(radius)) return null;
  if (p.mode !== 'reveal' && p.mode !== 'hide') return null;
  if (p.shape !== 'brush' && p.shape !== 'rect') return null;
  if (!Array.isArray(p.points)) return null;
  const points: [number, number][] = [];
  for (const pt of p.points) {
    if (!Array.isArray(pt) || pt.length !== 2) return null;
    const x = Number(pt[0]), y = Number(pt[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push([x, y]);
  }
  return { pageId, mode: p.mode, shape: p.shape, points, radius };
}

export function registerFogHandlers(
  socket: Socket,
  io: { sockets: { sockets: Map<string, Socket> } },
  db: Database.Database,
): void {
  socket.on('fog:stroke_preview', (raw: RawStrokePayload) => {
    if ((socket.data as SessionData).role !== 'dm') {
      return socket.emit('error', { code: 'forbidden', message: 'DM only' });
    }
    const parsed = parseRaw(raw);
    if (!parsed) {
      return socket.emit('error', { code: 'bad_payload', message: 'invalid' });
    }
    if (!findPageById(db, parsed.pageId)) {
      return socket.emit('error', { code: 'not_found', message: 'unknown page' });
    }
    const active = findActivePage(db);
    broadcastFogEvent(
      io as never,
      'fog:stroking',
      {
        page_id: parsed.pageId,
        mode: parsed.mode,
        shape: parsed.shape,
        points: parsed.points,
        radius: parsed.radius,
      },
      active?.id ?? null,
      { skipSocketId: socket.id },
    );
  });

  socket.on('fog:stroke_commit', (raw: RawStrokePayload) => {
    if ((socket.data as SessionData).role !== 'dm') {
      return socket.emit('error', { code: 'forbidden', message: 'DM only' });
    }
    const parsed = parseRaw(raw);
    if (!parsed) {
      return socket.emit('error', { code: 'bad_payload', message: 'invalid' });
    }
    const page = findPageById(db, parsed.pageId);
    if (!page) {
      return socket.emit('error', { code: 'not_found', message: 'unknown page' });
    }
    if (page.backgroundAssetId === null) {
      return socket.emit('error', { code: 'bad_payload', message: 'page has no background' });
    }
    const asset = findAssetById(db, page.backgroundAssetId);
    if (!asset) {
      return socket.emit('error', { code: 'bad_payload', message: 'background missing' });
    }
    const result = validateAndNormalizeStroke(
      { mode: parsed.mode, shape: parsed.shape, points: parsed.points, radius: parsed.radius },
      asset.width,
      asset.height,
    );
    if (!result.ok) {
      return socket.emit('error', { code: 'bad_payload', message: result.error });
    }
    const stroke = insertFogStroke(db, {
      pageId: parsed.pageId,
      mode: result.stroke.mode,
      shape: result.stroke.shape,
      points: result.stroke.points,
      radius: result.stroke.radius,
    });
    const active = findActivePage(db);
    broadcastFogEvent(
      io as never,
      'fog:stroke_added',
      { page_id: parsed.pageId, stroke: fogStrokeToPayload(stroke) },
      active?.id ?? null,
    );
  });
}
