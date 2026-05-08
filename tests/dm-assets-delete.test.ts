import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { startTestServer, type TestServer } from './helpers/testServer.js';

async function bootstrapDm(ts: TestServer): Promise<string> {
  const r = await request(ts.server).get('/api/dm/bootstrap');
  return (r.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
}

async function uploadMap(ts: TestServer, dm: string): Promise<{ id: number; hash: string }> {
  const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .png().toBuffer();
  const r = await request(ts.server).post('/api/dm/assets/upload')
    .set('Cookie', dm).attach('file', png, 'm.png').field('kind', 'map');
  return { id: r.body.asset.id, hash: r.body.asset.hash };
}

async function uploadToken(ts: TestServer, dm: string): Promise<{ id: number }> {
  const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 4, g: 5, b: 6 } } })
    .png().toBuffer();
  const r = await request(ts.server).post('/api/dm/assets/upload')
    .set('Cookie', dm).attach('file', png, 't.png').field('kind', 'token');
  return { id: r.body.asset.id };
}

describe('DELETE /api/dm/assets/:id', () => {
  let ts: TestServer;
  let dm: string;
  beforeEach(async () => { ts = await startTestServer(); dm = await bootstrapDm(ts); });
  afterEach(async () => { await ts.close(); });

  it('rejects without DM auth', async () => {
    expect((await request(ts.server).delete('/api/dm/assets/1')).status).toBe(401);
  });

  it('204 happy path; file removed; row gone', async () => {
    const a = await uploadMap(ts, dm);
    const before = await fs.stat(path.join(process.env.UPLOADS_DIR!, `${a.hash}.webp`));
    expect(before.isFile()).toBe(true);
    const res = await request(ts.server).delete(`/api/dm/assets/${a.id}`).set('Cookie', dm);
    expect(res.status).toBe(204);
    await expect(fs.stat(path.join(process.env.UPLOADS_DIR!, `${a.hash}.webp`))).rejects.toThrow();
    const list = await request(ts.server).get('/api/dm/assets?kind=map').set('Cookie', dm);
    expect(list.body.assets.find((x: { id: number }) => x.id === a.id)).toBeUndefined();
  });

  it('404 unknown id', async () => {
    const res = await request(ts.server).delete('/api/dm/assets/9999').set('Cookie', dm);
    expect(res.status).toBe(404);
  });

  it('409 with page reference', async () => {
    const a = await uploadMap(ts, dm);
    await request(ts.server).post('/api/dm/pages').set('Cookie', dm).send({
      name: 'Caves', background_asset_id: a.id, grid_width_squares: 20, grid_height_squares: 15,
    });
    const res = await request(ts.server).delete(`/api/dm/assets/${a.id}`).set('Cookie', dm);
    expect(res.status).toBe(409);
    expect(res.body.references.pages).toHaveLength(1);
    expect(res.body.references.pages[0].name).toBe('Caves');
    expect(res.body.references.tokens).toEqual([]);
  });

  it('409 with token reference', async () => {
    const map = await uploadMap(ts, dm);
    const tok = await uploadToken(ts, dm);
    const page = await request(ts.server).post('/api/dm/pages').set('Cookie', dm).send({
      name: 'P', background_asset_id: map.id, grid_width_squares: 20, grid_height_squares: 15,
    });
    await request(ts.server).post('/api/dm/tokens').set('Cookie', dm).send({
      page_id: page.body.page.id, asset_id: tok.id, x: 0, y: 0, name: 'Goblin',
    });
    const res = await request(ts.server).delete(`/api/dm/assets/${tok.id}`).set('Cookie', dm);
    expect(res.status).toBe(409);
    expect(res.body.references.tokens).toHaveLength(1);
    expect(res.body.references.tokens[0].name).toBe('Goblin');
  });
});
