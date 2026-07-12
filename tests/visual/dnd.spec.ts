import { expect, test, type Page } from '@playwright/test';
import { onboard } from './helpers';

/**
 * Long-press drag-and-drop in the file tree: hold a note row, then move to
 * drag a ghost onto a folder to file the note there. Releasing without
 * moving keeps the old behavior — the file actions sheet.
 */

interface Finger {
  cdp: Awaited<ReturnType<import('@playwright/test').BrowserContext['newCDPSession']>>;
  x: number;
  y: number;
}

const point = (x: number, y: number) => [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }];

async function touchDown(page: Page, x: number, y: number): Promise<Finger> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x, y) });
  return { cdp, x, y };
}

async function touchTo(page: Page, f: Finger, x: number, y: number, steps = 8, pause = 24) {
  const fromX = f.x;
  const fromY = f.y;
  for (let i = 1; i <= steps; i++) {
    const nx = fromX + ((x - fromX) * i) / steps;
    const ny = fromY + ((y - fromY) * i) / steps;
    await f.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(nx, ny) });
    await page.waitForTimeout(pause);
  }
  f.x = x;
  f.y = y;
}

async function touchEnd(f: Finger): Promise<void> {
  await f.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await f.cdp.detach();
}

/** Open the drawer and wait out its slide-in, so row boxes are stable. */
async function openTree(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Welcome', exact: true }).waitFor();
  await page.waitForTimeout(250);
}

/** Center of a row, for touch coordinates. */
async function center(page: Page, name: string): Promise<{ x: number; y: number }> {
  const box = await page.getByRole('button', { name, exact: true }).boundingBox();
  if (!box) throw new Error(`row "${name}" not visible`);
  return { x: box.x + Math.min(120, box.width / 2), y: box.y + box.height / 2 };
}

test('long-press + move drags a note into a folder', async ({ page }) => {
  await onboard(page);
  await openTree(page);
  const welcome = await center(page, 'Welcome');
  const projects = await center(page, 'Projects');

  const f = await touchDown(page, welcome.x, welcome.y);
  await page.waitForTimeout(600); // long-press arms the drag…
  await expect(page.locator('.tree-drag-ghost')).toBeVisible(); // …ghost lifted
  await touchTo(page, f, projects.x, projects.y);
  // The folder under the finger highlights as the drop target.
  await expect(page.getByRole('button', { name: 'Projects', exact: true })).toHaveClass(
    /tree-row--drop/,
  );
  await touchEnd(f);

  // Drag layer cleaned up…
  await expect(page.locator('.tree-drag-ghost')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-tree-drag'))).toBe(
    false,
  );
  // …no sheet (this was a drag, not a long-press menu)…
  await expect(page.locator('.sheet')).toHaveCount(0);
  // …and the tree shows Welcome nested inside Projects (depth-1 indent).
  const moved = page.getByRole('button', { name: 'Welcome', exact: true });
  await expect(moved).toHaveCSS('padding-left', '46px');

  // The file really moved: it opens fine at its new path.
  await moved.click();
  await expect(page.locator('.inline-title')).toHaveValue('Welcome');
});

test('long-press + release still opens the file actions sheet', async ({ page }) => {
  await onboard(page);
  await openTree(page);
  const welcome = await center(page, 'Welcome');

  const f = await touchDown(page, welcome.x, welcome.y);
  await page.waitForTimeout(600);
  await touchEnd(f);

  await expect(page.locator('.sheet')).toBeVisible();
  await expect(page.locator('.sheet')).toContainText('Rename');
  await expect(page.locator('.tree-drag-ghost')).toHaveCount(0);
  // Releasing did not navigate anywhere.
  await expect(page.locator('.inline-title')).toHaveCount(0);
});

test('dropping outside the tree cancels the move', async ({ page }) => {
  await onboard(page);
  await openTree(page);
  // Drag a NESTED file (Basalt lives in Projects). A real cancel leaves it
  // nested; only an accidental move-to-root would change its indent — so this
  // distinguishes cancellation from a root-drop (dragging a root file couldn't).
  const basalt = await center(page, 'Basalt');
  // The view-switcher pill floats below the tree scroller (outside
  // .sidebar__content) — a genuine non-target. Compute its position rather than
  // hardcoding a Y, which collides with rows as the vault grows.
  const pill = await center(page, 'Files');

  const f = await touchDown(page, basalt.x, basalt.y);
  await page.waitForTimeout(600); // long-press arms the drag…
  await expect(page.locator('.tree-drag-ghost')).toBeVisible(); // …ghost lifted
  await touchTo(page, f, pill.x, pill.y);
  await touchEnd(f);

  await expect(page.locator('.tree-drag-ghost')).toHaveCount(0);
  await expect(page.locator('.sheet')).toHaveCount(0);
  // Basalt stays nested inside Projects (depth-1 indent, 46px) — a cancelled
  // drop, NOT a move to root (which would be 28px).
  await expect(page.getByRole('button', { name: 'Basalt', exact: true })).toHaveCSS(
    'padding-left',
    '46px',
  );
});

test('a short tap still just opens the note', async ({ page }) => {
  await onboard(page);
  await openTree(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  await expect(page.locator('.inline-title')).toHaveValue('Welcome');
});
