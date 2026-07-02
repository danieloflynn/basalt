import { expect, test } from '@playwright/test';
import { onboard, swipe } from './helpers';

/** The Obsidian-mobile touch gestures, exercised with real touch streams. */

test('swipe right opens the drawer', async ({ page }) => {
  await onboard(page);
  await swipe(page, { x: 20, y: 400 }, { x: 280, y: 405 });
  await expect(page.locator('.sidebar[data-open]')).toBeVisible();
});

test('swipe left puts the drawer away', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect(page.locator('.sidebar[data-open]')).toBeVisible();

  await swipe(page, { x: 300, y: 400 }, { x: 40, y: 405 });
  await expect(page.locator('.sidebar[data-open]')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeHidden();
});

test('a mostly-vertical drag scrolls instead of dragging the drawer', async ({ page }) => {
  await onboard(page);
  await swipe(page, { x: 200, y: 300 }, { x: 215, y: 600 });
  await expect(page.locator('.sidebar[data-open]')).toHaveCount(0);
});

test('half-hearted swipe springs back closed', async ({ page }) => {
  await onboard(page);
  // Drag out a quarter of the way, pause so it's not a fling, release.
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(20, 400) });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: point(20 + i * 8, 400),
    });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(250); // dwell — kills the fling velocity
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();

  await expect(page.locator('.sidebar[data-open]')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeHidden();
});

test('pull down on a note opens quick open', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  await page.locator('.inline-title').waitFor();
  await page.waitForTimeout(250); // let the sidebar-close transition finish

  await swipe(page, { x: 200, y: 250 }, { x: 205, y: 500 }, 12);
  await expect(page.locator('.quickopen')).toBeVisible();
});

test('pull down mid-scroll does nothing', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Showcase' }).click();
  await page.locator('.inline-title').waitFor();
  await page.locator('.scroll').evaluate((el) => el.scrollTo(0, 400));

  await swipe(page, { x: 200, y: 250 }, { x: 205, y: 500 });
  await expect(page.locator('.quickopen')).toHaveCount(0);
});
