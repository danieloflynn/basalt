import { expect, test, type Page } from '@playwright/test';
import { onboard, settle } from './helpers';

/**
 * Graph-view features: the settings panel (filters/groups/display/forces),
 * node drag, and the wand timelapse. These lean on a dev-only inspection hook
 * (`window.__graphDebug`) exposed by GraphScreen under import.meta.env.DEV.
 */

interface GraphDebug {
  count: () => number;
  nodes: () => Array<{ id: string; kind: string; x: number; y: number }>;
  screen: (id: string) => { x: number; y: number } | null;
  timelapsing: () => boolean;
}

async function openGraph(page: Page): Promise<void> {
  await onboard(page);
  await page.getByRole('button', { name: 'Command palette' }).click();
  await page.getByRole('button', { name: 'Open graph view' }).click();
  await page.locator('canvas').waitFor();
}

/** Count non-transparent canvas pixels (same technique as visual.spec test 21). */
function paintedPixels(page: Page): Promise<number> {
  return page.locator('canvas').evaluate((c) => {
    const cv = c as HTMLCanvasElement;
    const ctx = cv.getContext('2d');
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  });
}

test.describe('graph features', () => {
  test('settings panel opens with all four sections', async ({ page }) => {
    await openGraph(page);
    await page.getByRole('button', { name: 'Graph settings' }).click();
    await page.getByRole('dialog', { name: 'Graph settings' }).waitFor();
    for (const section of ['Filters', 'Groups', 'Display', 'Forces']) {
      await expect(page.getByRole('button', { name: section, exact: true })).toBeVisible();
    }
    await page.waitForTimeout(400); // slide-in settle
    await settle(page);
    await expect(page).toHaveScreenshot('32-graph-panel.png');
  });

  test('a filter visibly changes the painted canvas', async ({ page }) => {
    await openGraph(page);
    await page.waitForTimeout(2500); // let the sim settle
    const before = await paintedPixels(page);
    expect(before).toBeGreaterThan(6000);

    await page.getByRole('button', { name: 'Graph settings' }).click();
    await page.getByRole('textbox', { name: 'Search files' }).fill('basalt');
    await page.waitForTimeout(1500); // rebuild + settle to the single matching node

    const after = await paintedPixels(page);
    expect(after).toBeLessThan(before);
  });

  test('a node can be dragged', async ({ page }) => {
    await openGraph(page);
    await page.waitForTimeout(2500);

    const target = await page.evaluate(() => {
      const g = (window as unknown as { __graphDebug: GraphDebug }).__graphDebug;
      const n = g.nodes()[0];
      return { id: n.id, before: { x: n.x, y: n.y }, screen: g.screen(n.id)! };
    });

    // Mouse actions dispatch pointer events in Chromium — a press on the node
    // starts a node drag (not a pan).
    await page.mouse.move(target.screen.x, target.screen.y);
    await page.mouse.down();
    await page.mouse.move(target.screen.x + 90, target.screen.y + 70, { steps: 12 });
    await page.mouse.up();

    const after = await page.evaluate((id) => {
      const g = (window as unknown as { __graphDebug: GraphDebug }).__graphDebug;
      const n = g.nodes().find((x) => x.id === id)!;
      return { x: n.x, y: n.y };
    }, target.id);

    const moved = Math.hypot(after.x - target.before.x, after.y - target.before.y);
    expect(moved).toBeGreaterThan(30);
  });

  test('wand timelapse reduces then restores node count', async ({ page }) => {
    await openGraph(page);
    await page.waitForTimeout(2500);

    const full = await page.evaluate(
      () => (window as unknown as { __graphDebug: GraphDebug }).__graphDebug.count(),
    );
    expect(full).toBeGreaterThan(1);

    await page.getByRole('button', { name: 'Graph timelapse' }).click();
    await page.waitForFunction(
      (f) => (window as unknown as { __graphDebug?: GraphDebug }).__graphDebug!.count() < f,
      full,
    );

    await page.getByRole('button', { name: 'Graph timelapse' }).click();
    await page.waitForFunction(
      (f) => (window as unknown as { __graphDebug?: GraphDebug }).__graphDebug!.count() === f,
      full,
    );
    const restored = await page.evaluate(
      () => (window as unknown as { __graphDebug: GraphDebug }).__graphDebug.count(),
    );
    expect(restored).toBe(full);
  });
});
