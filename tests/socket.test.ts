import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { startTestServer, type TestServer } from './helpers/testServer.js';

describe('Socket.IO server (pre-auth, M1 behavior)', () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startTestServer();
  });

  afterAll(async () => {
    await ts.close();
  });

  it('emits hello on client connect', () => {
    return new Promise<void>((resolve, reject) => {
      const client: ClientSocket = ioc(ts.url, { transports: ['websocket'] });
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
