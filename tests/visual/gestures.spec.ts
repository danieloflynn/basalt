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

test('a mostly-vertical drag scrolls the note instead of dragging the drawer', async ({ page }) => {
  await onboard(page);
  // Open a long note so a vertical drag has somewhere to scroll.
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Showcase' }).click();
  await page.locator('.inline-title').waitFor();
  await page.waitForTimeout(250); // let the sidebar-close transition finish

  const before = await page.locator('.scroll').evaluate((el) => el.scrollTop);
  // Near-vertical upward swipe: the drawer layer must ignore it (side-agnostic
  // threshold), so the note scrolls and no drawer opens.
  await swipe(page, { x: 200, y: 600 }, { x: 215, y: 250 });
  await expect(page.locator('.sidebar[data-open]')).toHaveCount(0);
  const after = await page.locator('.scroll').evaluate((el) => el.scrollTop);
  expect(after).toBeGreaterThan(before); // positive signal: scrolling actually happened
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

  // Positive control: the gesture layer is alive — a decisive fling still opens
  // the drawer, so "stayed closed" above is a real spring-back, not a dead handler.
  await swipe(page, { x: 20, y: 400 }, { x: 300, y: 405 });
  await expect(page.locator('.sidebar[data-open]')).toBeVisible();
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

  // Positive control: back at the top, the identical pull-down DOES open quick
  // open — so the null result above is the mid-scroll guard, not a dead handler.
  await page.locator('.scroll').evaluate((el) => el.scrollTo(0, 0));
  await page.waitForTimeout(50);
  await swipe(page, { x: 200, y: 250 }, { x: 205, y: 500 }, 12);
  await expect(page.locator('.quickopen')).toBeVisible();
});

/**
 * Regressions for the "drawer caught halfway" bug. The invariant under test:
 * however a touch sequence ends (release, browser cancel, or a fresh touch
 * mid-settle), the drawer lands in exactly one of {open, closed} and the DOM
 * layer leaves NO residual state — no inline `transform` pinning it partway and
 * no `data-drawer-drag` on <html>. The cleanup must be synchronous on the end
 * event, so it is asserted immediately after touchEnd/touchCancel, before any
 * settle animation has had a chance to run.
 */

interface Finger {
  cdp: Awaited<ReturnType<import('@playwright/test').BrowserContext['newCDPSession']>>;
  x: number;
  y: number;
}

const point = (x: number, y: number) => [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }];

async function touchDown(page: import('@playwright/test').Page, x: number, y: number): Promise<Finger> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x, y) });
  return { cdp, x, y };
}

/** Drag the finger to (x, y) in `steps`, pausing `pause` ms per step. */
async function touchTo(page: import('@playwright/test').Page, f: Finger, x: number, y: number, steps = 6, pause = 24): Promise<void> {
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

async function touchEnd(f: Finger, type: 'touchEnd' | 'touchCancel' = 'touchEnd'): Promise<void> {
  await f.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [] });
  await f.cdp.detach();
}

/** State the DOM layer must leave behind the instant a gesture ends. */
async function residue(
  page: import('@playwright/test').Page,
  sidebar = '.sidebar',
  scrim = '.scrim--sidebar',
) {
  return page.evaluate(
    ([sb, sc]) => ({
      drag: document.documentElement.hasAttribute('data-drawer-drag'),
      transform: document.querySelector<HTMLElement>(sb)?.style.transform ?? '<none>',
      scrimOpacity: document.querySelector<HTMLElement>(sc)?.style.opacity ?? '<none>',
    }),
    [sidebar, scrim],
  );
}

test('slow drag past halfway settles fully open, leaving no inline residue', async ({ page }) => {
  await onboard(page);
  // Drawer is full-width now (~393); drag well past its midpoint, slowly so it
  // is decided by position, not velocity. A pending rAF must not survive it.
  const f = await touchDown(page, 20, 400);
  await touchTo(page, f, 250, 405, 8, 28);
  await page.waitForTimeout(240); // dwell kills any fling velocity
  await touchEnd(f);

  const r = await residue(page);
  expect(r.drag).toBe(false); // data-drawer-drag cleared synchronously
  expect(r.transform).toBe(''); // no inline transform left pinning it partway

  await expect(page.locator('.sidebar[data-open]')).toBeVisible();
});

test('slow drag under halfway springs back closed, leaving no inline residue', async ({ page }) => {
  await onboard(page);
  const f = await touchDown(page, 20, 400);
  await touchTo(page, f, 120, 405, 8, 28); // ~100px < half → closes
  await page.waitForTimeout(240);
  await touchEnd(f);

  const r = await residue(page);
  expect(r.drag).toBe(false);
  expect(r.transform).toBe('');

  await expect(page.locator('.sidebar[data-open]')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeHidden();
});

test('a browser touchcancel mid-drag settles and cleans up', async ({ page }) => {
  await onboard(page);
  // Android WebView fires touchcancel aggressively when it claims the gesture.
  const f = await touchDown(page, 20, 400);
  await touchTo(page, f, 130, 405, 8, 28); // partial, under half
  await page.waitForTimeout(120);
  await touchEnd(f, 'touchCancel');

  const r = await residue(page);
  expect(r.drag).toBe(false); // must not leave transitions killed forever
  expect(r.transform).toBe(''); // must not leave the drawer frozen partway

  await expect(page.locator('.sidebar[data-open]')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeHidden();
});

test('a reverse fling during the settle window is honored, not swallowed', async ({ page }) => {
  await onboard(page);
  await swipe(page, { x: 20, y: 400 }, { x: 300, y: 405 }); // fling open
  await expect(page.locator('.sidebar[data-open]')).toBeVisible();
  await page.waitForTimeout(30); // still inside the old async-commit window
  await swipe(page, { x: 320, y: 400 }, { x: 40, y: 405 }); // fling closed

  const r = await residue(page);
  expect(r.drag).toBe(false);
  expect(r.transform).toBe('');

  await expect(page.locator('.sidebar[data-open]')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeHidden();
});

test('a fresh drag interrupting the settle animation still ends decisively', async ({ page }) => {
  await onboard(page);
  // Fling open, then immediately grab the still-animating drawer and drag it
  // back open again with a second finger sequence — no stale timer may fire
  // into this drag and strand it.
  await swipe(page, { x: 20, y: 400 }, { x: 300, y: 405 });
  await page.waitForTimeout(20);
  const f = await touchDown(page, 300, 400);
  await touchTo(page, f, 60, 405, 8, 24); // drag toward closed
  await page.waitForTimeout(200);
  await touchEnd(f);

  const r = await residue(page);
  expect(r.drag).toBe(false);
  expect(r.transform).toBe('');
  // Deterministic single outcome (closed here — dragged past half toward shut).
  await expect(page.locator('.sidebar[data-open]')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeHidden();

  // The interrupting drag belongs to the LEFT drawer it grabbed — it must not
  // leak into the right drawer. Under the old buggy settle the stale timer fired
  // mid-drag and mis-opened the RIGHT drawer (which incidentally closed the left
  // one, so every left-side assertion above still passed). Pin that down.
  await expect(page.locator('.sidebar-right[data-open]')).toHaveCount(0);
  await expect(page.locator('.sidebar-right')).toBeHidden();
  const rightResidue = await residue(page, '.sidebar-right', '.scrim--rightbar');
  expect(rightResidue.transform).toBe(''); // no inline transform pinning it partway
});

/**
 * The right drawer (backlinks): swipe left opens it, swipe right puts it
 * away, and it obeys the same settle invariants as the left one. When either
 * drawer is open, a swipe belongs to IT (closing), never to the other.
 */

/** Open the Welcome demo note (linked from Reading List and Old Note). */
async function openWelcome(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  await page.locator('.inline-title').waitFor();
  await page.waitForTimeout(250); // let the sidebar-close transition finish
}

test('swipe left opens the backlinks drawer for the current note', async ({ page }) => {
  await onboard(page);
  await openWelcome(page);
  // y=210 sits over plain paragraph text — no horizontally scrollable content.
  await swipe(page, { x: 370, y: 210 }, { x: 80, y: 215 });
  await expect(page.locator('.sidebar-right[data-open]')).toBeVisible();
  await expect(page.locator('.sidebar-right')).toContainText('Linked mentions');
  await expect(page.locator('.sidebar-right')).toContainText('Reading List');
  await expect(page.locator('.sidebar-right')).toContainText('Old Note');
});

test('swipe right puts the backlinks drawer away', async ({ page }) => {
  await onboard(page);
  await openWelcome(page);
  await swipe(page, { x: 370, y: 210 }, { x: 80, y: 215 });
  await expect(page.locator('.sidebar-right[data-open]')).toBeVisible();

  await swipe(page, { x: 80, y: 400 }, { x: 350, y: 405 });
  await expect(page.locator('.sidebar-right[data-open]')).toHaveCount(0);
  await expect(page.locator('.sidebar-right')).toBeHidden();
});

test('tapping a linked mention navigates there and closes the drawer', async ({ page }) => {
  await onboard(page);
  await openWelcome(page);
  await swipe(page, { x: 370, y: 210 }, { x: 80, y: 215 });
  await page.locator('.sidebar-right').getByText('Reading List').click();
  await expect(page.locator('.sidebar-right[data-open]')).toHaveCount(0);
  await expect(page.locator('.inline-title')).toHaveValue('Reading List');
});

test('with no note open the panel still opens and says "No backlinks"', async ({ page }) => {
  await onboard(page);
  await swipe(page, { x: 370, y: 400 }, { x: 80, y: 405 });
  await expect(page.locator('.sidebar-right[data-open]')).toBeVisible();
  await expect(page.locator('.sidebar-right')).toContainText('No backlinks');
});

test('a left-swipe with the left drawer open closes it — not open the right', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect(page.locator('.sidebar[data-open]')).toBeVisible();

  await swipe(page, { x: 300, y: 400 }, { x: 40, y: 405 });
  await expect(page.locator('.sidebar[data-open]')).toHaveCount(0);
  await expect(page.locator('.sidebar-right[data-open]')).toHaveCount(0);
  await expect(page.locator('.sidebar-right')).toBeHidden();
});

test('a right-swipe with the right drawer open closes it — not open the left', async ({ page }) => {
  await onboard(page);
  await swipe(page, { x: 370, y: 400 }, { x: 80, y: 405 });
  await expect(page.locator('.sidebar-right[data-open]')).toBeVisible();

  await swipe(page, { x: 80, y: 400 }, { x: 350, y: 405 });
  await expect(page.locator('.sidebar-right[data-open]')).toHaveCount(0);
  await expect(page.locator('.sidebar[data-open]')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeHidden();
});

test('slow right-drawer drag past halfway settles open, no inline residue', async ({ page }) => {
  await onboard(page);
  // Drawer is full-width now (~393); 230px of leftward travel clears its half.
  const f = await touchDown(page, 370, 400);
  await touchTo(page, f, 140, 405, 8, 28);
  await page.waitForTimeout(240); // dwell kills any fling velocity
  await touchEnd(f);

  const r = await residue(page, '.sidebar-right', '.scrim--rightbar');
  expect(r.drag).toBe(false);
  expect(r.transform).toBe('');

  await expect(page.locator('.sidebar-right[data-open]')).toBeVisible();
});

test('slow right-drawer drag under halfway springs back closed, no residue', async ({ page }) => {
  await onboard(page);
  const f = await touchDown(page, 370, 400);
  await touchTo(page, f, 280, 405, 8, 28); // ~90px < half → closes
  await page.waitForTimeout(240);
  await touchEnd(f);

  const r = await residue(page, '.sidebar-right', '.scrim--rightbar');
  expect(r.drag).toBe(false);
  expect(r.transform).toBe('');

  await expect(page.locator('.sidebar-right[data-open]')).toHaveCount(0);
  await expect(page.locator('.sidebar-right')).toBeHidden();

  // Positive control: the right-drawer gesture layer is alive — a decisive drag
  // past halfway still settles it open, so the spring-back above is meaningful.
  const g = await touchDown(page, 370, 400);
  await touchTo(page, g, 120, 405, 8, 28);
  await page.waitForTimeout(240);
  await touchEnd(g);
  await expect(page.locator('.sidebar-right[data-open]')).toBeVisible();
});

/**
 * Both drawers are now full-width (the old 52px gutter is gone). The settle math
 * is element-measured, so the existing threshold drags above still pass — this
 * pins the new geometry: an open drawer spans the whole viewport, both sides.
 */
test('both drawers open to the full viewport width', async ({ page }) => {
  await onboard(page);
  const vw = page.viewportSize()!.width;

  // Left (files) drawer via the toggle.
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect(page.locator('.sidebar[data-open]')).toBeVisible();
  const leftW = await page
    .locator('.sidebar')
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.round(leftW)).toBe(vw);

  // Close it, then open the right (backlinks) drawer via a left-swipe.
  await swipe(page, { x: 300, y: 400 }, { x: 40, y: 405 });
  await expect(page.locator('.sidebar[data-open]')).toHaveCount(0);
  await swipe(page, { x: 370, y: 400 }, { x: 80, y: 405 });
  await expect(page.locator('.sidebar-right[data-open]')).toBeVisible();
  const rightW = await page
    .locator('.sidebar-right')
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.round(rightW)).toBe(vw);
});
