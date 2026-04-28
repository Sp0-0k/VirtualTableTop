import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'http';
import { createServer } from '../server/src/server.js';

describe('GET /api/health', () => {
  let server: Server;

  beforeAll(() => {
    server = createServer();
  });

  afterAll(() => {
    server.close();
  });

  it('returns 200 with { ok: true }', async () => {
    const res = await request(server).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
