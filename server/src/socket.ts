import type http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';

export function attachSocketIO(httpServer: http.Server): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: false },
  });

  io.on('connection', (socket) => {
    socket.emit('hello', { greeting: 'connected' });
  });

  return io;
}
