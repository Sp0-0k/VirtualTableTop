import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { startTestServer, type TestServer } from './helpers/testServer.js';

async function makePng(): Promise<Buffer> {
  return sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .png()
    .toBuffer();
}

async function bootstrapDmCookie(ts: TestServer): Promise<string> {
  const res = await request(ts.server).get('/api/dm/bootstrap');
  const arr = res.headers['set-cookie'] as unknown as string[];
  return arr.map((c) => c.split(';')[0]).join('; ');
}

async function uploadMap(ts: TestServer, cookie: string): Promise<number> {
  const png = await makePng();
  const res = await request(ts.server)
    .post('/api/dm/assets/upload')
    .set('Cookie', cookie)
    .attach('file', png, 'm.png')
    .field('kind', 'map');
  return res.body.asset.id;
}

describe('DM pages routes', () => {
  let ts: TestServer;
  let dm: string;

  beforeEach(async () => {
    ts = await startTestServer();
    dm = await bootstrapDmCookie(ts);
  });

  afterEach(async () => {
    await ts.close();
  });

  it('rejects all routes without DM auth', async () => {
    const r1 = await request(ts.server).get('/api/dm/pages');
    expect(r1.status).toBe(401);
    const r2 = await request(ts.server).post('/api/dm/pages').send({});
    expect(r2.status).toBe(401);
  });

  it('POST creates a page with sort_order=0, is_active=0', async () => {
    const assetId = await uploadMap(ts, dm);
    const res = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({
        name: 'Caves',
        background_asset_id: assetId,
        grid_width_squares: 30,
        grid_height_squares: 20,
      });
    expect(res.status).toBe(201);
    expect(res.body.page.name).toBe('Caves');
    expect(res.body.page.sort_order).toBe(0);
    expect(res.body.page.is_active).toBe(0);
    expect(res.body.page.background_url).toMatch(/^\/assets\/[0-9a-f]{64}\.webp$/);
  });

  it('POST rejects bad input with 400', async () => {
    const res = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ grid_width_squares: 20, grid_height_squares: 15 }); // missing name
    expect(res.status).toBe(400);
  });

  it('POST rejects unknown background_asset_id with 400', async () => {
    const res = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({
        name: 'A',
        background_asset_id: 9999,
        grid_width_squares: 20,
        grid_height_squares: 15,
      });
    expect(res.status).toBe(400);
  });

  it('GET lists pages sorted by sort_order with resolved background_url', async () => {
    const assetId = await uploadMap(ts, dm);
    await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'A', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });
    await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'B', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });

    const res = await request(ts.server).get('/api/dm/pages').set('Cookie', dm);
    expect(res.status).toBe(200);
    expect(res.body.pages.length).toBe(2);
    expect(res.body.pages[0].name).toBe('A');
    expect(res.body.pages[1].name).toBe('B');
    expect(res.body.pages[0].background_url).toMatch(/\.webp$/);
  });

  it('PATCH updates a page', async () => {
    const assetId = await uploadMap(ts, dm);
    const created = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'A', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });
    const id = created.body.page.id;

    const res = await request(ts.server)
      .patch(`/api/dm/pages/${id}`)
      .set('Cookie', dm)
      .send({ name: 'A renamed' });
    expect(res.status).toBe(200);
    expect(res.body.page.name).toBe('A renamed');
  });

  it('PATCH 404 on unknown id', async () => {
    const res = await request(ts.server)
      .patch('/api/dm/pages/9999')
      .set('Cookie', dm)
      .send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  it('PUT set-active makes exactly one page active', async () => {
    const assetId = await uploadMap(ts, dm);
    const r1 = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'A', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });
    const r2 = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'B', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });

    await request(ts.server)
      .put(`/api/dm/pages/${r1.body.page.id}/set-active`)
      .set('Cookie', dm);
    await request(ts.server)
      .put(`/api/dm/pages/${r2.body.page.id}/set-active`)
      .set('Cookie', dm);

    const list = await request(ts.server).get('/api/dm/pages').set('Cookie', dm);
    const active = list.body.pages.filter((p: { is_active: number }) => p.is_active === 1);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(r2.body.page.id);
  });

  it('DELETE 409 when active', async () => {
    const assetId = await uploadMap(ts, dm);
    const r = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'A', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });
    await request(ts.server).put(`/api/dm/pages/${r.body.page.id}/set-active`).set('Cookie', dm);

    const del = await request(ts.server)
      .delete(`/api/dm/pages/${r.body.page.id}`)
      .set('Cookie', dm);
    expect(del.status).toBe(409);
  });

  it('DELETE 204 on a non-active page', async () => {
    const assetId = await uploadMap(ts, dm);
    const r = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'A', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });

    const del = await request(ts.server)
      .delete(`/api/dm/pages/${r.body.page.id}`)
      .set('Cookie', dm);
    expect(del.status).toBe(204);
  });

  it('set-active broadcasts state:active_page_changed to all sockets', async () => {
    const { io } = await import('socket.io-client');
    const assetId = await uploadMap(ts, dm);
    const r = await request(ts.server)
      .post('/api/dm/pages')
      .set('Cookie', dm)
      .send({ name: 'A', background_asset_id: assetId, grid_width_squares: 20, grid_height_squares: 15 });

    const client = io(ts.url, {
      transports: ['websocket'],
      extraHeaders: { Cookie: dm },
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('connect timeout')), 2000);
      client.on('connect', () => {
        clearTimeout(t);
        resolve();
      });
    });

    const eventPromise = new Promise<{ activePage: { id: number } | null }>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('event timeout')), 2000);
      client.once('state:active_page_changed', (payload) => {
        clearTimeout(t);
        resolve(payload);
      });
    });

    await request(ts.server).put(`/api/dm/pages/${r.body.page.id}/set-active`).set('Cookie', dm);

    const event = await eventPromise;
    expect(event.activePage?.id).toBe(r.body.page.id);
    client.close();
  });
});
