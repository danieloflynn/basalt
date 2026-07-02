import type { Page } from '@playwright/test';

/** Frozen "now" so daily notes, timestamps and "time ago" render identically. */
export const FIXED_TIME = new Date('2026-07-02T09:00:00');

/** Complete the fake onboarding into the demo vault (mock git engine). */
export async function onboard(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto('/');
  await page.getByText('Connect a repository').click();
  await page.locator('input').nth(0).fill('danieloflynn/vault');
  await page.locator('input').nth(1).fill('danieloflynn');
  await page.locator('input').nth(2).fill('github_pat_demo');
  await page.getByText('Continue').click();
  await page.getByRole('button', { name: 'main' }).click();
  await page.getByText('No note is open').waitFor();
  await settle(page);
}

/** Wait for webfonts so text metrics are identical across runs. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Open the sidebar and switch it to the given view via the switcher pill. */
export async function openSidebarView(
  page: Page,
  view: 'Files' | 'Search' | 'Tags' | 'All properties' | 'Bookmarks',
): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.locator('.switcher__pill').click();
  await page.getByRole('button', { name: view, exact: true }).click();
}

/**
 * Touch swipe via CDP (Playwright's touchscreen API has no drag). Quick steps
 * read as a fling, which is what a real thumb does.
 */
export async function swipe(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: point(from.x, from.y),
  });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: point(
        from.x + ((to.x - from.x) * i) / steps,
        from.y + ((to.y - from.y) * i) / steps,
      ),
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
