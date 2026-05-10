import type http from 'node:http';
import { Server as SocketIOServer, type DefaultEventsMap } from 'socket.io';
import * as cookie from 'cookie';
import type Database from 'better-sqlite3';
import { verifyCookie } from './auth/cookies.js';
import { COOKIE_DM, COOKIE_PLAYER } from './auth/constants.js';
import { findPlayerById } from './db/players.js';
import { buildFullSync } from './broadcast.js';
import { createPresence } from './presence.js';
import { registerTokenMoveHandlers } from './socket/token-move.js';
import { registerFogHandlers } from './socket/fog.js';

export interface SocketDeps {
  db: Database.Database;
}

export type SessionData =
  | { role: 'dm'; name: 'DM'; playerId: null }
  | { role: 'player'; name: string; playerId: number };

export type AppSocketIOServer = SocketIOServer<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SessionData
>;

export function attachSocketIO(httpServer: http.Server, deps: SocketDeps): AppSocketIOServer {
  const io: AppSocketIOServer = new SocketIOServer(httpServer, {
    cors: { origin: false },
  });

  const presence = createPresence();

  io.use((socket, next) => {
    const cookies = cookie.parse(socket.handshake.headers.cookie ?? '');

    if (verifyCookie(cookies[COOKIE_DM]) === '1') {
      socket.data = { role: 'dm', name: 'DM', playerId: null };
      return next();
    }

    const playerIdStr = verifyCookie(cookies[COOKIE_PLAYER]);
    if (playerIdStr !== null) {
      const player = findPlayerById(deps.db, Number(playerIdStr));
      if (player) {
        socket.data = { role: 'player', name: player.name, playerId: player.id };
        return next();
      }
    }

    return next(new Error('not authenticated'));
  });

  io.on('connection', (socket) => {
    if (socket.data.role === 'dm') socket.join('dm');
    socket.emit('session', socket.data);
    if (socket.data.role === 'player' && socket.data.playerId !== null) {
      presence.connect(socket.data.playerId, socket.id);
    }
    socket.emit('state:full_sync', buildFullSync(deps.db, socket, presence));
    registerTokenMoveHandlers(socket, io, deps.db);
    registerFogHandlers(socket, io, deps.db);
  });

  return io;
}
