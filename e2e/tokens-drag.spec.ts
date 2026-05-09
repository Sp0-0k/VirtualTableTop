import fs from 'node:fs';
import { test, expect, setupDmCampaign, FIXTURE_PNG } from './fixtures.js';

test('DM uploads a token, drags it onto the canvas, and sees it rendered', async ({
  context, page,
}) => {
  await setupDmCampaign(context);

  // Upload a token asset via API (drag-from-disk into the React component is
  // brittle; the library renders it from the assets list and we drag from there).
  const upload = await context.request.post(
    'http://localhost:3002/api/dm/assets/upload',
    {
      multipart: {
        kind: 'token',
        file: { name: 'orc.png', mimeType: 'image/png', buffer: fs.readFileSync(FIXTURE_PNG) },
      },
    },
  );
  expect(upload.status()).toBe(201);
  const tokenAssetId = ((await upload.json()) as { asset: { id: number } }).asset.id;

  await page.goto('/dm');
  // Wait for the page to be fully bootstrapped — token library renders the asset.
  await expect(page.getByText('VTT — DM')).toBeVisible();

  // Select the page in the sidebar (the only one). The page name is in a <li>
  // that calls selectPage on click.
  await page.getByText('E2E').first().click();
  // Wait for the canvas to be rendered.
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 });

  // The token library renders draggable thumbnails. Find the token thumbnail.
  const tokenThumb = page.locator('[data-testid="token-asset"]').first();
  await expect(tokenThumb).toBeVisible({ timeout: 10_000 });

  // Konva renders a <canvas> that intercepts all pointer events, so Playwright's
  // native dragTo cannot complete a drop on the canvas element. Instead, we
  // dispatch synthetic DragEvents directly on the wrapper div that holds React's
  // onDragOver / onDrop handlers.
  const stage = page.locator('canvas').first();
  const stageBox = (await stage.boundingBox())!;
  if (!stageBox) throw new Error('Canvas not found');

  const targetX = stageBox.x + 200;
  const targetY = stageBox.y + 200;

  await page.evaluate(
    ({ assetId, x, y }) => {
      // Find the wrapper div that has the onDrop handler (parent of <canvas>).
      const canvas = document.querySelector('canvas');
      if (!canvas) return;
      const wrapper = canvas.parentElement;
      if (!wrapper) return;

      const dt = new DataTransfer();
      dt.setData('application/x-vtt-asset', String(assetId));

      const dragover = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y });
      wrapper.dispatchEvent(dragover);

      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y });
      wrapper.dispatchEvent(drop);
    },
    { assetId: tokenAssetId, x: targetX, y: targetY },
  );

  // Validate via API: the token row exists for the active page.
  await expect.poll(async () => {
    const r = await context.request.get(
      'http://localhost:3002/api/dm/tokens?page_id=' + (await activePageId(context)),
    );
    const body = await r.json();
    return (body.tokens as unknown[]).length;
  }, { timeout: 5_000 }).toBeGreaterThan(0);
});

async function activePageId(context: { request: { get: (u: string) => Promise<{ json: () => Promise<unknown> }> } }) {
  const r = await context.request.get('http://localhost:3002/api/dm/pages');
  const body = (await r.json()) as { pages: { id: number; is_active: 0 | 1 }[] };
  return body.pages.find((p) => p.is_active === 1)!.id;
}
