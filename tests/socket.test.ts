import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createServer } from '../server/src/server.js';

describe('Socket.IO server', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    url = `http://localhost:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('emits hello on client connect', () => {
    return new Promise<void>((resolve, reject) => {
      const client: ClientSocket = ioc(url, { transports: ['websocket'] });
      const timer = setTimeout(() => {
        client.close();
        reject(new Error('timed out waiting for hello'));
      }, 2000);

      client.on('hello', (msg: { greeting: string }) => {
        try {
          expect(msg).toEqual({ greeting: 'connected' });
          clearTimeout(timer);
          client.close();
          resolve();
        } catch (err) {
          reject(err as Error);
        }
      });
    });
  });
});
