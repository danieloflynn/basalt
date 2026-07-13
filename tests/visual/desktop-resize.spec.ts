import { expect, test } from '@playwright/test';
import { onboard } from './helpers';

/**
 * Draggable pane boundaries (desktop): the file-tree edge, the right-sidebar
 * edge, and the split divider resize by pointer drag, persist to localStorage,
 * and reset on double-click. Functional assertions only — the handles are
 * invisible at rest, so the pixel baselines elsewhere stay untouched.
 */
test.use({
  viewport: { width: 1280, height: 860 },
  isMobile: false,
  hasTouch: false,
  colorScheme: 'dark',
});

async function dragHandle(
  page: import('@playwright/test').Page,
  label: string,
  dx: number,
): Promise<void> {
  const handle = page.getByRole('separator', { name: label });
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

const sidebarWidth = (page: import('@playwright/test').Page) =>
  page.locator('.shell > .sidebar').evaluate((el) => el.getBoundingClientRect().width);

test('dragging the sidebar edge resizes it and persists to localStorage', async ({ page }) => {
  await onboard(page);
  expect(await sidebarWidth(page)).toBeCloseTo(260, 0);

  await dragHandle(page, 'Resize sidebar', 90);
  expect(await sidebarWidth(page)).toBeCloseTo(350, 0);

  // Persisted for the next launch. (The browser demo vault itself is
  // in-memory and can't survive a reload, so assert the stored payload —
  // the load path is unit-tested in paneSizes.test.ts.)
  const stored = await page.evaluate(() => localStorage.getItem('basalt.paneSizes.v1'));
  expect(JSON.parse(stored!).sidebarW).toBe(350);

  // Double-click snaps back to the default width.
  await page.getByRole('separator', { name: 'Resize sidebar' }).dblclick();
  expect(await sidebarWidth(page)).toBeCloseTo(260, 0);
  const reset = await page.evaluate(() => localStorage.getItem('basalt.paneSizes.v1'));
  expect(JSON.parse(reset!).sidebarW).toBe(260);
});

test('dragging clamps at the minimum width', async ({ page }) => {
  await onboard(page);
  await dragHandle(page, 'Resize sidebar', -500);
  expect(await sidebarWidth(page)).toBeCloseTo(180, 0);
});

test('the right sidebar edge drags symmetrically', async ({ page }) => {
  await onboard(page);
  const width = () =>
    page.locator('.shell > .sidebar-right').evaluate((el) => el.getBoundingClientRect().width);
  expect(await width()).toBeCloseTo(300, 0);
  await dragHandle(page, 'Resize right sidebar', -80); // left = wider
  expect(await width()).toBeCloseTo(380, 0);
});

test('the split divider re-balances the two panes', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  await page.locator('.inline-title').waitFor();
  // String form: a literal import('/src/…') is a vite-dev-server path that
  // tsc cannot resolve from this spec file.
  await page.evaluate(
    `import('/src/state/nav.ts').then((m) => m.useNav.getState().openToTheRight('Reading List.md'))`,
  );
  await page.locator('.split-pane .inline-title').waitFor();

  const widths = () =>
    page.evaluate(() => {
      const main = document.querySelector('.shell > .screen')!.getBoundingClientRect().width;
      const split = document.querySelector('.shell > .split-pane')!.getBoundingClientRect().width;
      return { main, split };
    });

  const before = await widths();
  expect(Math.abs(before.main - before.split)).toBeLessThan(10); // ~50/50 default

  await dragHandle(page, 'Resize split pane', 120);
  const after = await widths();
  expect(after.main).toBeGreaterThan(before.main + 100);
  expect(after.split).toBeLessThan(before.split - 100);
});

test('desktop editing shows no formatting toolbar (keyboard-first)', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  await page.getByRole('button', { name: 'Edit note' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('typing ');
  await expect(page.locator('.editor-toolbar')).toHaveCount(0);
});
