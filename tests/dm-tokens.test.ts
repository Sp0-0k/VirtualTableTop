import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { startTestServer, type TestServer } from './helpers/testServer.js';

async function bootstrapDm(ts: TestServer): Promise<string> {
  const res = await request(ts.server).get('/api/dm/bootstrap');
  return (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
}

async function uploadAsset(ts: TestServer, cookie: string, kind: 'map' | 'token'): Promise<number> {
  const png = await sharp({ create: {
    width: kind === 'map' ? 1000 : 200,
    height: kind === 'map' ? 800 : 200,
    channels: 3, background: { r: 9, g: 9, b: 9 },
  } }).png().toBuffer();
  const res = await request(ts.server)
    .post('/api/dm/assets/upload')
    .set('Cookie', cookie)
    .attach('file', png, `${kind}.png`)
    .field('kind', kind);
  return res.body.asset.id;
}

async function createPage(ts: TestServer, cookie: string, mapAssetId: number): Promise<number> {
  const res = await request(ts.server).post('/api/dm/pages').set('Cookie', cookie).send({
    name: 'P', background_asset_id: mapAssetId, grid_width_squares: 20, grid_height_squares: 15,
  });
  return res.body.page.id;
}

describe('DM tokens routes', () => {
  let ts: TestServer;
  let dm: string;

  beforeEach(async () => {
    ts = await startTestServer();
    dm = await bootstrapDm(ts);
  });
  afterEach(async () => { await ts.close(); });

  it('rejects without DM auth', async () => {
    expect((await request(ts.server).get('/api/dm/tokens?page_id=1')).status).toBe(401);
    expect((await request(ts.server).post('/api/dm/tokens').send({})).status).toBe(401);
  });

  it('POST creates a token with defaults', async () => {
    const mapId = await uploadAsset(ts, dm, 'map');
    const tokAsset = await uploadAsset(ts, dm, 'token');
    const pageId = await createPage(ts, dm, mapId);
    const res = await request(ts.server).post('/api/dm/tokens').set('Cookie', dm).send({
      page_id: pageId, asset_id: tokAsset, x: 100, y: 200,
    });
    expect(res.status).toBe(201);
    expect(res.body.token.x).toBe(100);
    expect(res.body.token.size_squares).toBe(1);
    expect(res.body.token.hidden).toBe(0);
    expect(res.body.token.asset_url).toMatch(/^\/assets\/[0-9a-f]{64}\.webp$/);
  });

  it('POST 400 for unknown asset_id', async () => {
    const mapId = await uploadAsset(ts, dm, 'map');
    const pageId = await createPage(ts, dm, mapId);
    const res = await request(ts.server).post('/api/dm/tokens').set('Cookie', dm).send({
      page_id: pageId, asset_id: 9999, x: 0, y: 0,
    });
    expect(res.status).toBe(400);
  });

  it('POST 400 for unknown page_id', async () => {
    const tokAsset = await uploadAsset(ts, dm, 'token');
    const res = await request(ts.server).post('/api/dm/tokens').set('Cookie', dm).send({
      page_id: 9999, asset_id: tokAsset, x: 0, y: 0,
    });
    expect(res.status).toBe(400);
  });

  it('POST 400 when asset_id is a map (not a token)', async () => {
    const mapId = await uploadAsset(ts, dm, 'map');
    const pageId = await createPage(ts, dm, mapId);
    const res = await request(ts.server).post('/api/dm/tokens').set('Cookie', dm).send({
      page_id: pageId, asset_id: mapId, x: 0, y: 0,
    });
    expect(res.status).toBe(400);
  });

  it('GET lists only the requested page', async () => {
    const mapId = await uploadAsset(ts, dm, 'map');
    const tokAsset = await uploadAsset(ts, dm, 'token');
    const p1 = await createPage(ts, dm, mapId);
    const p2 = await createPage(ts, dm, mapId);
    await request(ts.server).post('/api/dm/tokens').set('Cookie', dm)
      .send({ page_id: p1, asset_id: tokAsset, x: 0, y: 0 });
    await request(ts.server).post('/api/dm/tokens').set('Cookie', dm)
      .send({ page_id: p2, asset_id: tokAsset, x: 0, y: 0 });
    const res = await request(ts.server)
      .get(`/api/dm/tokens?page_id=${p1}`)
      .set('Cookie', dm);
    expect(res.status).toBe(200);
    expect(res.body.tokens).toHaveLength(1);
    expect(res.body.tokens[0].page_id).toBe(p1);
  });
});
