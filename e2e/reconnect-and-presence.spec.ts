import { test, expect, setupDmCampaign, joinAsPlayer } from './fixtures.js';

test('player drops out of DM header on disconnect and reappears on reconnect', async ({ browser }) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();

  await setupDmCampaign(dmContext);
  await joinAsPlayer(playerContext, 'Robin', '#33aa66');

  const dmPage = await dmContext.newPage();
  const playerPage = await playerContext.newPage();

  await dmPage.goto('/dm');
  await playerPage.goto('/');
  await expect(dmPage.getByText('connected')).toBeVisible({ timeout: 10_000 });
  await expect(playerPage.getByText('connected')).toBeVisible({ timeout: 10_000 });

  // DM header should list the player as online.
  await expect(dmPage.locator('header').getByText('Robin')).toBeVisible({ timeout: 5_000 });

  // Force the player socket to disconnect (without closing the tab).
  await playerPage.waitForFunction(
    () => Boolean((window as unknown as { __vttSocket?: unknown }).__vttSocket),
    null,
    { timeout: 5_000 },
  );
  await playerPage.evaluate(() => {
    (window as unknown as {
      __vttSocket: { disconnect: () => void };
    }).__vttSocket.disconnect();
  });

  // Player name disappears from the DM header.
  await expect(dmPage.locator('header').getByText('Robin')).toBeHidden({ timeout: 5_000 });

  // Reconnect the player socket.
  await playerPage.evaluate(() => {
    (window as unknown as {
      __vttSocket: { connect: () => void };
    }).__vttSocket.connect();
  });

  // Player reappears, and the player view stays connected (i.e., full_sync rebuilt state).
  await expect(dmPage.locator('header').getByText('Robin')).toBeVisible({ timeout: 5_000 });
  await expect(playerPage.getByText('connected')).toBeVisible({ timeout: 10_000 });

  await dmContext.close();
  await playerContext.close();
});
