import { test, expect, setupDmCampaign, joinAsPlayer } from './fixtures.js';

test('fog round-trip: paint, sync, persist, clear', async ({ browser }) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();

  const { pageId } = await setupDmCampaign(dmContext);
  await joinAsPlayer(playerContext, 'Riley', '#cc6633');

  const dmPage = await dmContext.newPage();
  const playerPage = await playerContext.newPage();
  await dmPage.goto('/dm');
  await playerPage.goto('/');
  await expect(dmPage.getByText('connected')).toBeVisible({ timeout: 10_000 });
  await expect(playerPage.getByText('connected')).toBeVisible({ timeout: 10_000 });

  // Select the page in the sidebar so previewPage is set (required for FogDock to mount).
  await dmPage.getByText('E2E').first().click();
  await expect(dmPage.locator('canvas').first()).toBeVisible({ timeout: 10_000 });

  // Switch DM to Fog tool — dock should appear.
  await dmPage.getByRole('button', { name: 'Fog' }).click();
  await expect(dmPage.getByRole('toolbar', { name: 'Fog tools' })).toBeVisible();

  // Player counts incoming fog:stroke_added events.
  await playerPage.waitForFunction(
    () => Boolean((window as unknown as { __vttSocket?: unknown }).__vttSocket),
    null, { timeout: 5_000 },
  );
  await playerPage.evaluate(() => {
    (window as unknown as { __fogCount: number }).__fogCount = 0;
    const sock = (window as unknown as {
      __vttSocket: { on: (e: string, cb: () => void) => void };
    }).__vttSocket;
    sock.on('fog:stroke_added', () => {
      (window as unknown as { __fogCount: number }).__fogCount += 1;
    });
    sock.on('fog:cleared', () => {
      (window as unknown as { __fogCount: number }).__fogCount = 0;
    });
  });

  // DM emits a reveal-brush stroke directly via socket (mirrors what Canvas paint does).
  const start = Date.now();
  await dmPage.evaluate(({ pageId }) => {
    (window as unknown as {
      __vttSocket: { emit: (e: string, p: unknown) => void };
    }).__vttSocket.emit('fog:stroke_commit', {
      pageId, mode: 'reveal', shape: 'brush',
      points: [[100, 100], [400, 100]], radius: 60,
    });
  }, { pageId });

  // Player receives the stroke within 200 ms.
  await expect.poll(
    async () => playerPage.evaluate(() => (window as unknown as { __fogCount: number }).__fogCount),
    { timeout: 1_000, intervals: [25, 50, 100] },
  ).toBeGreaterThan(0);
  expect(Date.now() - start).toBeLessThan(500);

  // Server has the row.
  const after = await dmContext.request.get(
    `http://localhost:3002/api/dm/pages/${pageId}/fog`,
  );
  expect((await after.json()).strokes).toHaveLength(1);

  // DM reloads — fog persists. The reloaded page should show the stroke
  // count through full_sync without us emitting anything.
  await dmPage.reload();
  await expect(dmPage.getByText('connected')).toBeVisible();
  // Re-select the page (zustand is in-memory, so selection is lost on reload).
  await dmPage.getByText('E2E').first().click();
  const persisted = await dmContext.request.get(
    `http://localhost:3002/api/dm/pages/${pageId}/fog`,
  );
  expect((await persisted.json()).strokes).toHaveLength(1);

  // "Reset to fogged" — accept the confirm dialog.
  await dmPage.getByRole('button', { name: 'Fog' }).click();
  dmPage.once('dialog', (d) => d.accept());
  await dmPage.getByRole('button', { name: 'Reset to fogged' }).click();

  // Player sees fog cleared (count resets to 0 in our hook), strokes table empty.
  await expect.poll(
    async () => playerPage.evaluate(() => (window as unknown as { __fogCount: number }).__fogCount),
    { timeout: 1_000 },
  ).toBe(0);
  const empty = await dmContext.request.get(
    `http://localhost:3002/api/dm/pages/${pageId}/fog`,
  );
  expect((await empty.json()).strokes).toHaveLength(0);

  // "Reveal everything" inserts one bbox-rect stroke.
  dmPage.once('dialog', (d) => d.accept());
  await dmPage.getByRole('button', { name: 'Reveal everything' }).click();
  await expect.poll(
    async () => {
      const r = await dmContext.request.get(
        `http://localhost:3002/api/dm/pages/${pageId}/fog`,
      );
      return ((await r.json()).strokes as unknown[]).length;
    },
    { timeout: 2_000 },
  ).toBe(1);

  await dmContext.close();
  await playerContext.close();
});
