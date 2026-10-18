import { expect, test } from '@playwright/test';

test('MapLibre module workers render interleaved deck layers without private-transform errors', async ({ page }) => {
  const rendererErrors: string[] = [];
  const workerUrls: string[] = [];
  page.on('pageerror', error => rendererErrors.push(error.message));
  page.on('worker', worker => workerUrls.push(worker.url()));
  await page.goto('/tests/map-harness.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mapHarness?.ready, null, { timeout: 45_000 });
  await expect(page.locator('#deckgl-basemap canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__mapHarness?.getDeckLayerSnapshot().length ?? 0)).toBeGreaterThan(0);
  await page.evaluate(() => window.__mapHarness?.setCamera({ lon: 100.5, lat: 13.7, zoom: 4 }));
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(workerUrls.some(url => url.includes('maplibre-gl-worker'))).toBe(true);
  expect(rendererErrors).toEqual([]);
});
