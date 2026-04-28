import type http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import type Database from 'better-sqlite3';

export interface SocketDeps {
  db: Database.Database;
}

export function attachSocketIO(httpServer: http.Server, _deps: SocketDeps): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: false },
  });

  io.on('connection', (socket) => {
    socket.emit('hello', { greeting: 'connected' });
  });

  return io;
}
