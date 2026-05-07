import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { startTestServer, type TestServer } from './helpers/testServer.js';

async function makePng(width: number, height: number, color = '#ff0000'): Promise<Buffer> {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return sharp({
    create: { width, height, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
}

async function bootstrapDmCookie(ts: TestServer): Promise<string> {
  const res = await request(ts.server).get('/api/dm/bootstrap');
  const setCookie = res.headers['set-cookie'];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie!];
  return arr.map((c: string) => c.split(';')[0]).join('; ');
}

describe('POST /api/dm/assets/upload', () => {
  let ts: TestServer;
  let dmCookie: string;

  beforeEach(async () => {
    ts = await startTestServer();
    dmCookie = await bootstrapDmCookie(ts);
    // Clean upload dir between tests so dedup behavior is testable.
    const dir = process.env.UPLOADS_DIR!;
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
  });

  afterEach(async () => {
    await ts.close();
  });

  it('rejects requests without DM auth', async () => {
    const png = await makePng(50, 50);
    const res = await request(ts.server)
      .post('/api/dm/assets/upload')
      .attach('file', png, 'red.png')
      .field('kind', 'map');
    expect(res.status).toBe(401);
  });

  it('uploads a PNG, writes the file to UPLOADS_DIR, returns 201', async () => {
    const png = await makePng(50, 50);
    const res = await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .attach('file', png, 'red.png')
      .field('kind', 'map');
    expect(res.status).toBe(201);
    expect(res.body.asset.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.asset.kind).toBe('map');
    expect(res.body.asset.originalName).toBe('red.png');
    const stored = path.join(process.env.UPLOADS_DIR!, `${res.body.asset.hash}.webp`);
    expect(fs.existsSync(stored)).toBe(true);
  });

  it('dedupes identical re-uploads (200, no second file)', async () => {
    const png = await makePng(50, 50);
    const first = await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .attach('file', png, 'a.png')
      .field('kind', 'map');
    expect(first.status).toBe(201);

    const beforeFiles = fs.readdirSync(process.env.UPLOADS_DIR!).length;

    const second = await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .attach('file', png, 'a-copy.png')
      .field('kind', 'map');
    expect(second.status).toBe(200);
    expect(second.body.asset.id).toBe(first.body.asset.id);

    const afterFiles = fs.readdirSync(process.env.UPLOADS_DIR!).length;
    expect(afterFiles).toBe(beforeFiles);
  });

  it('rejects non-image bytes with 400', async () => {
    const garbage = Buffer.from('not an image');
    const res = await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .attach('file', garbage, 'fake.png')
      .field('kind', 'map');
    expect(res.status).toBe(400);
  });

  it('rejects oversized request bodies with 413', async () => {
    const huge = Buffer.alloc(6 * 1024 * 1024); // 6 MB
    const res = await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .attach('file', huge, 'big.bin')
      .field('kind', 'map');
    expect(res.status).toBe(413);
  });

  it('rejects requests missing the file field with 400', async () => {
    const res = await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .field('kind', 'map');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/dm/assets', () => {
  let ts: TestServer;
  let dmCookie: string;

  beforeEach(async () => {
    ts = await startTestServer();
    dmCookie = await bootstrapDmCookie(ts);
  });

  afterEach(async () => {
    await ts.close();
  });

  it('rejects without DM auth', async () => {
    const res = await request(ts.server).get('/api/dm/assets?kind=map');
    expect(res.status).toBe(401);
  });

  it('lists uploaded maps newest first', async () => {
    const a = await makePng(40, 40, '#ff0000');
    const b = await makePng(40, 40, '#00ff00');
    await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .attach('file', a, 'a.png')
      .field('kind', 'map');
    await request(ts.server)
      .post('/api/dm/assets/upload')
      .set('Cookie', dmCookie)
      .attach('file', b, 'b.png')
      .field('kind', 'map');

    const res = await request(ts.server)
      .get('/api/dm/assets?kind=map')
      .set('Cookie', dmCookie);
    expect(res.status).toBe(200);
    expect(res.body.assets.length).toBe(2);
    expect(res.body.assets[0].originalName).toBe('b.png');
    expect(res.body.assets[1].originalName).toBe('a.png');
  });
});
