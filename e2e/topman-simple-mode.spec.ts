import { expect, test, type Page } from '@playwright/test';

async function installLocalOnlyNetwork(page: Page): Promise<void> {
  await page.route(/^https?:\/\/(?!(127\.0\.0\.1:4173|localhost:4173)(?:\/|$)).*/i, (route) => {
    return route.abort('blockedbyclient');
  });
}

async function seedSimpleMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('worldmonitor-variant', 'full');
    localStorage.setItem('topman-ui-mode-v1', 'simple');
    localStorage.setItem('topman-guided-tour-dismissed-v1', '1');
    localStorage.setItem('topman-guided-tour-completed-v1', '1');
  });
}

async function waitForEventHandlers(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.wmEventHandlersReady === 'true', null, {
    timeout: 30_000,
  });
}

async function waitForSimpleShell(page: Page): Promise<void> {
  await expect(page.locator('.topman-simple-shell--top, .topman-simple-shell')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.topman-simple-cards .topman-simple-card')).toHaveCount(3, { timeout: 15_000 });
}

test.describe('TOPMAN Simple Mode', () => {
  test('opens simple mode with three cards and mode toggle', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedSimpleMode(page);
    await installLocalOnlyNetwork(page);
    await page.goto('/dashboard?mode=simple', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);
    await waitForSimpleShell(page);

    await expect(page.locator('html')).toHaveAttribute('data-topman-ui-mode', 'simple');
    await expect(page.locator('[data-tour="summary"]')).toBeVisible();
    await expect(page.locator('[data-tour="map-categories"] .topman-simple-chip')).toHaveCount(5);
    await expect(page.locator('#topmanModeToggle')).toBeVisible();
  });

  test('switches to advanced and back to simple', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedSimpleMode(page);
    await installLocalOnlyNetwork(page);
    await page.goto('/dashboard?mode=simple', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);
    await waitForSimpleShell(page);

    await page.locator('[data-action="switch-advanced"]').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-topman-ui-mode', 'advanced', { timeout: 10_000 });
    await expect(page.locator('.topman-simple-advanced-strip')).toBeVisible();

    await page.locator('[data-action="switch-simple"]').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-topman-ui-mode', 'simple', { timeout: 10_000 });
    await expect(page.locator('.topman-simple-cards .topman-simple-card')).toHaveCount(3);
  });

  test('mobile 390px keeps simple summary without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSimpleMode(page);
    await installLocalOnlyNetwork(page);
    await page.goto('/dashboard?mode=simple', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);
    await waitForSimpleShell(page);

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        mode: doc.dataset.topmanUiMode,
      };
    });
    expect(overflow.mode).toBe('simple');
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
    await expect(page.locator('[data-tour="summary"]')).toBeInViewport();
  });
});
