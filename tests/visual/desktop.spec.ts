import { expect, test } from '@playwright/test';
import { onboard, settle } from './helpers';

/**
 * Desktop (docked, three-pane) layout — Basalt as a Mac app / wide window.
 * A wide, non-touch viewport trips the (min-width: 960px) query, so both
 * sidebars dock as columns, the tab strip appears, and the bottom pill and
 * swipe gestures step aside. Mirrors the phone specs but at desk width.
 */
test.use({
  viewport: { width: 1280, height: 860 },
  isMobile: false,
  hasTouch: false,
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});

test('empty workspace docks both sidebars with the tab strip', async ({ page }) => {
  await onboard(page);
  // Docked, not overlaid: the file tree and backlinks pane are both visible
  // alongside the empty state, and the tab strip sits on top.
  await expect(page.locator('.desktop-chrome')).toBeVisible();
  await expect(page.locator('.shell[data-desktop][data-left][data-right]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Welcome', exact: true })).toBeVisible();
  await expect(page.locator('.sidebar-right')).toContainText('Backlinks');
  await settle(page);
  await expect(page).toHaveScreenshot('desktop-01-empty.png');
});

test('opening a note fills the centre column and lists backlinks', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  // Reader in the centre column; backlinks (Reading List, Old Note, Sync Pulse)
  // in the docked right column.
  await expect(page.locator('.inline-title')).toHaveValue('Welcome');
  await expect(page.locator('.sidebar-right')).toContainText('Reading List');
  await expect(page.locator('.desktop-tab[data-active]')).toContainText('Welcome');
  await settle(page);
  await expect(page).toHaveScreenshot('desktop-02-note.png');
});

test('collapsing the backlinks panel widens the centre column', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle backlinks' }).click();
  await expect(page.locator('.shell[data-desktop][data-right]')).toHaveCount(0);
  await settle(page);
  await expect(page).toHaveScreenshot('desktop-03-note-wide.png');
});
