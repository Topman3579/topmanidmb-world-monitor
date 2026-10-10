import { expect, test, type Page } from '@playwright/test';

async function installLocalOnlyNetwork(page: Page): Promise<void> {
  await page.route(/^https?:\/\/(?!(127\.0\.0\.1:4173|localhost:4173)(?:\/|$)).*/i, (route) => {
    return route.abort('blockedbyclient');
  });
}

async function seedSimpleMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('topman-e2e-seeded')) return;
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('topman-e2e-seeded', '1');
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
  await expect(page.locator('.topman-simple-shell--top')).toBeVisible({ timeout: 20_000 });
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
    await expect(page.locator('.panels-grid')).toBeHidden();
    await expect(page.locator('.community-widget')).toBeHidden();
  });

  test('preserves an edited draft across mode switches', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedSimpleMode(page);
    await installLocalOnlyNetwork(page);
    await page.goto('/dashboard?mode=simple', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);
    await waitForSimpleShell(page);

    const editor = page.locator('#topman-daily-brief-line');
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.fill('ร่างทดสอบที่ต้องคงอยู่เมื่อสลับโหมด');
    await page.locator('[data-action="switch-advanced"]').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-topman-ui-mode', 'advanced');
    await page.locator('[data-action="switch-simple"]').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-topman-ui-mode', 'simple');
    await expect(page.locator('#topman-daily-brief-line')).toHaveValue('ร่างทดสอบที่ต้องคงอยู่เมื่อสลับโหมด');
  });

  test('autosaves typed edits before a browser reload and keeps newer local edits over older approved server content', async ({ page }) => {
    await seedSimpleMode(page);
    await installLocalOnlyNetwork(page);
    await page.goto('/dashboard?mode=simple', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);
    await waitForSimpleShell(page);
    const editor = page.locator('#topman-daily-brief-line');
    await expect(editor).toBeVisible();
    await editor.fill('ร่างใหม่ต้องอยู่หลังรีเฟรช โดยไม่ต้องกดบันทึก');
    const saved = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('topman-daily-brief-local:')).map(k => JSON.parse(localStorage.getItem(k)!)).find(b => b.lineMessage.includes('ร่างใหม่ต้องอยู่')));
    expect(saved).toBeTruthy();
    await page.route('**/api/topman-daily-brief', async route => {
      await route.fulfill({ json: { ok: true, lineConfigured: false, dateKey: saved.dateKey, brief: { ...saved, lineMessage: 'older approved server text', status: 'approved', updatedAt: new Date(Date.parse(saved.updatedAt) - 60_000).toISOString() } } });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);
    await expect(editor).toHaveValue('ร่างใหม่ต้องอยู่หลังรีเฟรช โดยไม่ต้องกดบันทึก');
  });

  test('keeps dirty drafts despite clock skew, exposes a sent server conflict, and restores a recovery copy on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSimpleMode(page);
    await installLocalOnlyNetwork(page);
    await page.goto('/dashboard?mode=simple', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);
    await waitForSimpleShell(page);
    const editor = page.locator('#topman-daily-brief-line');
    await editor.fill('synthetic local recovery draft');
    const saved = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('topman-daily-brief-local:')).map(k => JSON.parse(localStorage.getItem(k)!)).find(b => b.lineMessage === 'synthetic local recovery draft'));
    const serverText = 'synthetic sent version ' + 'x'.repeat(400);
    await page.route('**/api/topman-daily-brief', route => route.fulfill({ json: { ok: true, lineConfigured: false, brief: { ...saved, revision: 'server-newer', lineMessage: serverText, status: 'sent', updatedAt: '2099-01-01T00:00:00Z' } } }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);
    await expect(editor).toHaveValue('synthetic local recovery draft');
    const conflict = page.locator('.topman-simple-daily-brief__conflict');
    await expect(conflict).toBeVisible();
    await conflict.locator('summary').click();
    await expect(conflict.locator('pre')).toHaveText(serverText);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
    await page.locator('[data-action="brief-load-server"]').click();
    await expect(editor).toHaveValue(serverText);
    await expect(page.locator('[data-action="brief-send"]')).toBeDisabled();
    await page.locator('[data-action="brief-recover-local"]').click();
    await expect(editor).toHaveValue('synthetic local recovery draft');
    await expect(conflict).toBeVisible();
  });

  test('preserves edits typed during approval and rebases an explicitly restored draft', async ({ page }) => {
    await seedSimpleMode(page);
    await installLocalOnlyNetwork(page);
    let pending: (() => Promise<void>) | undefined;
    let serverBrief: Record<string, unknown> | undefined;
    const savedRevisions: Array<string | null> = [];
    await page.route('**/api/topman-daily-brief**', async route => {
      const req = route.request();
      if (req.url().includes('session=1')) return route.fulfill({ json: { ok: true, authenticated: true, expiresAt: Date.now() + 900_000 } });
      if (req.method() === 'POST') {
        const body = req.postDataJSON();
        savedRevisions.push(body.expectedRevision);
        serverBrief = { ...body.brief, revision: `revision-${savedRevisions.length}`, status: 'approved' };
        pending = () => route.fulfill({ json: { ok: true, lineConfigured: false, brief: serverBrief } });
        return;
      }
      return route.fulfill({ json: { ok: true, lineConfigured: false, brief: serverBrief ?? null } });
    });
    await page.goto('/dashboard?mode=simple', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);
    await waitForSimpleShell(page);
    const editor = page.locator('#topman-daily-brief-line');
    await editor.fill('synthetic submitted copy');
    await page.locator('[data-action="brief-save"]').click();
    await expect.poll(() => Boolean(pending)).toBe(true);
    await editor.fill('synthetic later keystrokes');
    await pending!();
    pending = undefined;
    await expect(page.locator('.topman-simple-daily-brief__conflict')).toBeVisible();
    await expect(editor).toHaveValue('synthetic later keystrokes');
    await expect(page.locator('[data-action="brief-send"]')).toBeDisabled();
    await page.locator('.topman-simple-daily-brief__conflict summary').click();
    await page.locator('[data-action="brief-load-server"]').click();
    await expect(editor).toHaveValue('synthetic submitted copy');
    await page.locator('[data-action="brief-recover-local"]').click();
    await expect(editor).toHaveValue('synthetic later keystrokes');
    await page.locator('[data-action="brief-save"]').click();
    await expect.poll(() => savedRevisions.length).toBe(2);
    expect(savedRevisions[1]).toBe('revision-1');
    await pending!();
    await expect(editor).toHaveValue('synthetic later keystrokes');
  });

  test('reviewer sign-in is labeled, masks input, and uses a cookie session without retaining the credential', async ({ page }) => {
    await seedSimpleMode(page);
    await installLocalOnlyNetwork(page);
    let loggedIn = false;
    const requests: Array<{ action: string; authorization: string | undefined }> = [];
    await page.route('**/api/topman-daily-brief**', async route => {
      const req = route.request();
      if (req.method() === 'POST') {
        const action = req.postDataJSON().action;
        requests.push({ action, authorization: req.headers().authorization });
        loggedIn = action === 'login';
        await route.fulfill({ json: { ok: true, authenticated: loggedIn, expiresAt: loggedIn ? Date.now() + 900_000 : null } });
      } else if (req.url().includes('session=1')) {
        await route.fulfill({ json: { ok: true, authenticated: loggedIn, expiresAt: loggedIn ? Date.now() + 900_000 : null } });
      } else await route.fulfill({ json: { ok: true, brief: null, lineConfigured: false } });
    });
    await page.goto('/dashboard?mode=simple', { waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);
    await waitForSimpleShell(page);
    const input = page.locator('#topman-review-password');
    await expect(input).toHaveAttribute('type', 'password');
    await expect(page.locator('label[for="topman-review-password"]')).toBeVisible();
    await input.fill('synthetic-test-credential');
    await page.locator('[data-action="brief-login"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-action="brief-logout"]')).toBeVisible();
    expect(requests[0]).toEqual({ action: 'login', authorization: 'Bearer synthetic-test-credential' });
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('synthetic-test-credential');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForEventHandlers(page);
    await expect(page.locator('[data-action="brief-logout"]')).toBeVisible();
    await page.locator('[data-action="brief-logout"]').focus();
    await page.keyboard.press('Enter');
    await expect(input).toBeVisible();
    expect(requests.at(-1)).toEqual({ action: 'logout', authorization: undefined });
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
