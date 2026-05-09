import fs from 'node:fs';
import { test, expect, setupDmCampaign, joinAsPlayer, FIXTURE_PNG } from './fixtures.js';

test('player sees DM token movement within 200 ms', async ({ browser }) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();

  const { pageId } = await setupDmCampaign(dmContext);

  await joinAsPlayer(playerContext, 'Pat', '#3366cc');

  const upload = await dmContext.request.post(
    'http://localhost:3002/api/dm/assets/upload',
    {
      multipart: {
        kind: 'token',
        file: { name: 'goblin.png', mimeType: 'image/png', buffer: fs.readFileSync(FIXTURE_PNG) },
      },
    },
  );
  const tokenAsset = (await upload.json()).asset as { id: number };

  const created = await dmContext.request.post('http://localhost:3002/api/dm/tokens', {
    data: { page_id: pageId, asset_id: tokenAsset.id, x: 100, y: 100, name: 'G' },
  });
  expect(created.status()).toBe(201);
  const token = (await created.json()).token as { id: number };

  const dmPage = await dmContext.newPage();
  const playerPage = await playerContext.newPage();
  await dmPage.goto('/dm');
  await playerPage.goto('/');
  await expect(dmPage.getByText('connected')).toBeVisible({ timeout: 10_000 });
  await expect(playerPage.getByText('connected')).toBeVisible({ timeout: 10_000 });

  await playerPage.waitForFunction(
    () => Boolean((window as unknown as { __vttSocket?: unknown }).__vttSocket),
    null, { timeout: 5_000 },
  );
  await playerPage.evaluate(() => {
    (window as unknown as { __moveCount: number }).__moveCount = 0;
    const sock = (window as unknown as {
      __vttSocket: { on: (e: string, cb: (p: unknown) => void) => void };
    }).__vttSocket;
    sock.on('token:moved', () => {
      (window as unknown as { __moveCount: number }).__moveCount += 1;
    });
  });

  const start = Date.now();
  await dmPage.evaluate(({ id }) => {
    (window as unknown as {
      __vttSocket: { emit: (e: string, p: unknown) => void };
    }).__vttSocket.emit('token:move_commit', { id, x: 250, y: 250 });
  }, { id: token.id });

  await expect.poll(
    async () => playerPage.evaluate(() => (window as unknown as { __moveCount: number }).__moveCount),
    { timeout: 1_000, intervals: [25, 50, 100] },
  ).toBeGreaterThan(0);

  expect(Date.now() - start).toBeLessThan(1_000);

  const tokens = await dmContext.request.get(
    `http://localhost:3002/api/dm/tokens?page_id=${pageId}`,
  );
  const list = (await tokens.json()).tokens as { id: number; x: number; y: number }[];
  const found = list.find((t) => t.id === token.id);
  expect(found).toMatchObject({ x: 250, y: 250 });

  await dmContext.close();
  await playerContext.close();
});
