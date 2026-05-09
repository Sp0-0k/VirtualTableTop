import { io, type Socket } from 'socket.io-client';

export const socket: Socket = io({
  transports: ['websocket'],
  autoConnect: false,
});

if (import.meta.env.DEV) {
  (window as unknown as { __vttSocket: typeof socket }).__vttSocket = socket;
}
