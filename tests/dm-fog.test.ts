import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { insertAsset } from '../server/src/db/assets.js';
import { createPage, setActivePage } from '../server/src/db/pages.js';
import { insertFogStroke, listFogStrokesByPage } from '../server/src/db/fog-strokes.js';

async function dmCookie(ts: TestServer): Promise<string> {
  const r = await request(ts.server).get('/api/dm/bootstrap');
  return (r.headers['set-cookie'] as unknown as string[])
    .map((c) => c.split(';')[0])
    .join('; ');
}

async function setupActivePage(ts: TestServer) {
  const m = insertAsset(ts.db, {
    hash: 'm', kind: 'map', originalName: 'm.png', mime: 'image/webp',
    width: 1000, height: 800, sizeBytes: 1,
  });
  const p = createPage(ts.db, {
    name: 'P', backgroundAssetId: m.id, gridWidthSquares: 10, gridHeightSquares: 8,
  });
  setActivePage(ts.db, p.id);
  return p.id;
}

describe('DELETE /api/dm/pages/:id/fog', () => {
  let ts: TestServer;
  beforeEach(async () => { ts = await startTestServer(); });
  afterEach(async () => { await ts.close(); });

  it('returns 401 without DM cookie', async () => {
    const id = await setupActivePage(ts);
    const r = await request(ts.server).delete(`/api/dm/pages/${id}/fog`);
    expect(r.status).toBe(401);
  });

  it('deletes all strokes and returns 204', async () => {
    const id = await setupActivePage(ts);
    insertFogStroke(ts.db, {
      pageId: id, mode: 'reveal', shape: 'brush', points: [[1, 1]], radius: 10,
    });
    insertFogStroke(ts.db, {
      pageId: id, mode: 'hide', shape: 'rect', points: [[0, 0], [10, 10]], radius: 0,
    });
    const cookie = await dmCookie(ts);
    const r = await request(ts.server)
      .delete(`/api/dm/pages/${id}/fog`)
      .set('Cookie', cookie);
    expect(r.status).toBe(204);
    expect(listFogStrokesByPage(ts.db, id)).toEqual([]);
  });

  it('returns 404 for unknown page', async () => {
    const cookie = await dmCookie(ts);
    const r = await request(ts.server)
      .delete('/api/dm/pages/999/fog')
      .set('Cookie', cookie);
    expect(r.status).toBe(404);
  });
});

describe('POST /api/dm/pages/:id/fog/reveal-all', () => {
  let ts: TestServer;
  beforeEach(async () => { ts = await startTestServer(); });
  afterEach(async () => { await ts.close(); });

  it('clears existing strokes and inserts a single bbox-rect reveal', async () => {
    const id = await setupActivePage(ts);
    insertFogStroke(ts.db, {
      pageId: id, mode: 'hide', shape: 'brush', points: [[1, 1]], radius: 10,
    });
    const cookie = await dmCookie(ts);
    const r = await request(ts.server)
      .post(`/api/dm/pages/${id}/fog/reveal-all`)
      .set('Cookie', cookie);
    expect(r.status).toBe(204);
    const strokes = listFogStrokesByPage(ts.db, id);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({
      mode: 'reveal',
      shape: 'rect',
      radius: 0,
      points: [[0, 0], [1000, 800]],
    });
  });

  it('returns 409 if page has no background asset', async () => {
    const p = createPage(ts.db, {
      name: 'no-bg', backgroundAssetId: null, gridWidthSquares: 10, gridHeightSquares: 10,
    });
    setActivePage(ts.db, p.id);
    const cookie = await dmCookie(ts);
    const r = await request(ts.server)
      .post(`/api/dm/pages/${p.id}/fog/reveal-all`)
      .set('Cookie', cookie);
    expect(r.status).toBe(409);
    expect(listFogStrokesByPage(ts.db, p.id)).toEqual([]);
  });

  it('returns 404 for unknown page', async () => {
    const cookie = await dmCookie(ts);
    const r = await request(ts.server)
      .post('/api/dm/pages/999/fog/reveal-all')
      .set('Cookie', cookie);
    expect(r.status).toBe(404);
  });
});
