import type Database from 'better-sqlite3';
import type { Socket } from 'socket.io';
import { broadcastTokenEvent } from '../broadcast.js';
import { findTokenById, updateTokenXY } from '../db/tokens.js';
import type { SessionData } from '../socket.js';

interface MovePayload { id: unknown; x: unknown; y: unknown }

function parsePayload(p: MovePayload): { id: number; x: number; y: number } | null {
  const id = Number(p.id), x = Number(p.x), y = Number(p.y);
  if (!Number.isInteger(id) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { id, x, y };
}

function canMove(socketData: SessionData, ownerPlayerId: number | null): boolean {
  if (socketData.role === 'dm') return true;
  return ownerPlayerId !== null && ownerPlayerId === socketData.playerId;
}

export function registerTokenMoveHandlers(
  socket: Socket,
  io: { sockets: { sockets: Map<string, Socket> } },
  db: Database.Database,
): void {
  socket.on('token:move_preview', (raw: MovePayload) => {
    const data = parsePayload(raw);
    if (!data) return socket.emit('error', { code: 'bad_payload', message: 'invalid' });
    const t = findTokenById(db, data.id);
    if (!t) return socket.emit('error', { code: 'not_found', message: 'unknown token' });
    if (!canMove(socket.data as SessionData, t.ownerPlayerId))
      return socket.emit('error', { code: 'forbidden', message: 'cannot move this token' });
    broadcastTokenEvent(io as never, db, 'token:moving',
      { ...t, x: data.x, y: data.y }, { skipSocketId: socket.id });
  });

  socket.on('token:move_commit', (raw: MovePayload) => {
    const data = parsePayload(raw);
    if (!data) return socket.emit('error', { code: 'bad_payload', message: 'invalid' });
    const t = findTokenById(db, data.id);
    if (!t) return socket.emit('error', { code: 'not_found', message: 'unknown token' });
    if (!canMove(socket.data as SessionData, t.ownerPlayerId))
      return socket.emit('error', { code: 'forbidden', message: 'cannot move this token' });
    const updated = updateTokenXY(db, data.id, data.x, data.y);
    broadcastTokenEvent(io as never, db, 'token:moved', updated);
  });
}
