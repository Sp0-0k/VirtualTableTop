import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type BrowserContext } from '@playwright/test';

export const FIXTURE_PNG = path.resolve('.e2e/map.png');

export async function resetServer(request: BrowserContext['request']) {
  const r = await request.post('http://localhost:3002/api/test/reset');
  expect(r.status()).toBe(204);
}

export async function dmAuth(context: BrowserContext) {
  const r = await context.request.get('http://localhost:3002/api/dm/bootstrap');
  expect(r.status()).toBeLessThan(400);
}

export async function joinAsPlayer(
  context: BrowserContext,
  name: string,
  color = '#cc3333',
) {
  const r = await context.request.post('http://localhost:3002/api/player/join', {
    data: { name, color },
  });
  expect(r.status()).toBeLessThan(400);
  const body = await r.json();
  return body.player as { id: number; name: string; color: string };
}

export async function setupDmCampaign(context: BrowserContext) {
  await dmAuth(context);
  const upload = await context.request.post(
    'http://localhost:3002/api/dm/assets/upload',
    {
      multipart: {
        kind: 'map',
        file: { name: 'map.png', mimeType: 'image/png', buffer: fs.readFileSync(FIXTURE_PNG) },
      },
    },
  );
  expect(upload.status()).toBe(201);
  const asset = (await upload.json()).asset as { id: number };

  const create = await context.request.post('http://localhost:3002/api/dm/pages', {
    data: {
      name: 'E2E',
      background_asset_id: asset.id,
      grid_width_squares: 16,
      grid_height_squares: 12,
    },
  });
  expect(create.status()).toBe(201);
  const page = (await create.json()).page as { id: number };

  const setActive = await context.request.put(
    `http://localhost:3002/api/dm/pages/${page.id}/set-active`,
  );
  expect(setActive.status()).toBeLessThan(400);

  return { assetId: asset.id, pageId: page.id };
}

export const test = base.extend<{ resetBefore: void }>({
  resetBefore: [
    async ({ context }, use) => {
      await resetServer(context.request);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
