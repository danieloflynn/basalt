import { expect, test, type Page } from '@playwright/test';
import { FIXED_TIME, onboard, openSidebarView, settle, swipe } from './helpers';

/**
 * Every screen and state of the app, pixel-compared against committed
 * baselines. Run `npx playwright test --update-snapshots` after an
 * intentional UI change and review the diff before committing.
 */

test.describe('onboarding', () => {
  test('welcome hero', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_TIME);
    await page.goto('/');
    await page.getByText('Connect a repository').waitFor();
    await settle(page);
    await expect(page).toHaveScreenshot('01-onboarding-welcome.png');
  });

  test('connect form, filled', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_TIME);
    await page.goto('/');
    await page.getByText('Connect a repository').click();
    await page.locator('input').nth(0).fill('danieloflynn/vault');
    await page.locator('input').nth(1).fill('danieloflynn');
    await page.locator('input').nth(2).fill('github_pat_demo');
    await settle(page);
    await expect(page).toHaveScreenshot('02-onboarding-connect.png');
  });

  test('branch picker', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_TIME);
    await page.goto('/');
    await page.getByText('Connect a repository').click();
    await page.locator('input').nth(0).fill('danieloflynn/vault');
    await page.locator('input').nth(1).fill('danieloflynn');
    await page.locator('input').nth(2).fill('github_pat_demo');
    await page.getByText('Continue').click();
    await page.getByRole('button', { name: 'main' }).waitFor();
    await settle(page);
    await expect(page).toHaveScreenshot('03-onboarding-branch.png');
  });
});

test.describe('workspace', () => {
  test('empty state with bottom pill', async ({ page }) => {
    await onboard(page);
    await expect(page).toHaveScreenshot('04-workspace-empty.png');
  });

  test('quick open', async ({ page }) => {
    await onboard(page);
    await page.getByRole('button', { name: 'Quick open' }).click();
    await page.locator('.quickopen').waitFor();
    await expect(page).toHaveScreenshot('05-quickopen.png');
  });

  test('command palette', async ({ page }) => {
    await onboard(page);
    await page.getByRole('button', { name: 'Command palette' }).click();
    await page.locator('.quickopen, .sheet').first().waitFor();
    await expect(page).toHaveScreenshot('06-command-palette.png');
  });

  test('tabs sheet', async ({ page }) => {
    await onboard(page);
    await page.getByRole('button', { name: 'Tabs' }).click();
    await page.locator('.sheet').waitFor();
    await expect(page).toHaveScreenshot('07-tabs-sheet.png');
  });
});

test.describe('sidebar', () => {
  test('file tree', async ({ page }) => {
    await onboard(page);
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await page.getByRole('button', { name: 'Welcome' }).waitFor();
    await expect(page).toHaveScreenshot('08-sidebar-files.png');
  });

  test('view switcher expanded', async ({ page }) => {
    await onboard(page);
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await page.locator('.switcher__pill').click();
    await page.locator('.switcher__list').waitFor();
    await expect(page).toHaveScreenshot('09-sidebar-switcher.png');
  });

  test('search: empty state hint', async ({ page }) => {
    await onboard(page);
    await openSidebarView(page, 'Search');
    await page.locator('.search-input').waitFor();
    await expect(page).toHaveScreenshot('10-sidebar-search-empty.png');
  });

  test('search: results with highlighted matches', async ({ page }) => {
    await onboard(page);
    await openSidebarView(page, 'Search');
    await page.locator('.search-input').fill('basalt');
    await page.locator('.hit__excerpt mark').first().waitFor();
    await expect(page).toHaveScreenshot('11-sidebar-search-results.png');
  });

  test('tags with counts', async ({ page }) => {
    await onboard(page);
    await openSidebarView(page, 'Tags');
    await page.getByRole('button', { name: /basalt/ }).waitFor();
    await expect(page).toHaveScreenshot('12-sidebar-tags.png');
  });

  test('properties, one expanded', async ({ page }) => {
    await onboard(page);
    await openSidebarView(page, 'All properties');
    await page.getByRole('button', { name: /status/ }).click();
    await expect(page).toHaveScreenshot('13-sidebar-properties.png');
  });

  test('bookmarks empty state', async ({ page }) => {
    await onboard(page);
    await openSidebarView(page, 'Bookmarks');
    await page.getByText('Bookmark notes').waitFor();
    await expect(page).toHaveScreenshot('14-sidebar-bookmarks.png');
  });

  test('vault menu', async ({ page }) => {
    await onboard(page);
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await page.getByRole('button', { name: /files, .* folders/ }).click();
    await page.locator('.vault-menu').waitFor();
    await expect(page).toHaveScreenshot('15-vault-menu.png');
  });

  test('right drawer backlinks', async ({ page }) => {
    await onboard(page);
    // Welcome is linked from Reading List and Old Note (demo vault).
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await page.getByRole('button', { name: 'Welcome', exact: true }).click();
    await page.locator('.inline-title').waitFor();
    await page.waitForTimeout(250); // sidebar-close transition
    await swipe(page, { x: 370, y: 210 }, { x: 80, y: 215 });
    await expect(page.locator('.sidebar-right[data-open]')).toBeVisible();
    await page.getByText('Linked mentions').waitFor();
    await page.waitForTimeout(250); // drawer transition
    await expect(page).toHaveScreenshot('31-right-drawer.png');
  });
});

async function openShowcase(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Showcase' }).click();
  await page.locator('.inline-title').waitFor();
}

test.describe('reading view', () => {
  test('note top: title, properties, headings', async ({ page }) => {
    await onboard(page);
    await openShowcase(page);
    // The Math section is in-frame; wait for KaTeX (lazy chunk) so the capture
    // never freezes the raw-LaTeX Suspense fallback.
    await page.locator('.katex').first().waitFor({ timeout: 20_000 });
    await settle(page);
    await expect(page).toHaveScreenshot('16-note-top.png');
  });

  test('math and mermaid render', async ({ page }) => {
    await onboard(page);
    await openShowcase(page);
    await page.locator('.katex').first().waitFor({ timeout: 20_000 });
    await page.locator('.mermaid-figure svg').first().waitFor({ timeout: 20_000 });
    await page
      .locator('.katex')
      .first()
      .evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await settle(page);

    // Deterministic guards so the loose pixel tolerance can't hide a KaTeX race
    // (raw LaTeX) or a mermaid that rendered without its edge labels.
    await expect(page.locator('.katex').first()).toBeVisible(); // inline $E = mc^2$ rendered
    // The KaTeX-race failure mode renders the raw dollar-delimited source. KaTeX
    // keeps the TeX in a hidden <annotation> (no dollars), so this only trips on
    // the fallback. `.first()`: Showcase embeds another note (nested .md--embed).
    await expect(page.locator('.md').first()).not.toContainText('$E = mc^2$');
    const mermaid = page.locator('.mermaid-figure svg').first();
    await expect(mermaid).toContainText('push'); // A -->|push| B edge label
    await expect(mermaid).toContainText('pull'); // B -->|pull| edge label

    await expect(page).toHaveScreenshot('17-note-math-mermaid.png', { maxDiffPixelRatio: 0.01 });
  });

  test('note menu', async ({ page }) => {
    await onboard(page);
    await openShowcase(page);
    await page.getByRole('button', { name: 'Note menu' }).click();
    await page.locator('.sheet').waitFor();
    await expect(page).toHaveScreenshot('18-note-menu.png');
  });
});

test.describe('editor', () => {
  test('live preview', async ({ page }) => {
    await onboard(page);
    await openShowcase(page);
    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.locator('.cm-content').waitFor();
    await settle(page);
    await expect(page).toHaveScreenshot('19-editor-live.png');
  });

  test('source mode', async ({ page }) => {
    await onboard(page);
    await openShowcase(page);
    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.locator('.cm-content').waitFor();
    // The toolbar (and its mode toggle) appears when the editor has focus.
    // Fixed near-top click: a center click lands the caret mid-document, and the
    // active-line markup reveal + caret scroll-into-view shift layout by a few
    // pixels run-to-run — enough to flake a pixel comparison.
    await page.locator('.cm-content').click({ position: { x: 20, y: 10 } });
    await page.getByRole('button', { name: 'Switch to source mode' }).click();
    await page.locator('.cm-content').waitFor();
    await settle(page);
    await expect(page).toHaveScreenshot('20-editor-source.png');
  });

  test('toolbar rides focus: pill hides while typing', async ({ page }) => {
    await onboard(page);
    await openShowcase(page);
    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.locator('.cm-content').waitFor();

    await expect(page.locator('.bottompill')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bold' })).toHaveCount(0);

    await page.locator('.cm-content').click();
    await expect(page.getByRole('button', { name: 'Bold' })).toBeVisible();
    await expect(page.locator('.bottompill')).toHaveCount(0);
  });

  test('editing toolbar, focused', async ({ page }) => {
    await onboard(page);
    await openShowcase(page);
    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.locator('.cm-content').waitFor();
    // Fixed near-top click — see the source-mode test for why a center click flakes.
    await page.locator('.cm-content').click({ position: { x: 20, y: 10 } });
    await expect(page.getByRole('button', { name: 'Bold' })).toBeVisible();
    await settle(page);
    // The click's caret scroll-into-view sometimes scrolls the editor by its top
    // padding and sometimes not (a measure-timing race in the app's editor, not
    // the app under test here) — pin the scroll so the capture frames one state.
    await page.locator('.cm-scroller').evaluate((el) => el.scrollTo(0, 0));
    await expect(page).toHaveScreenshot('30-editor-toolbar.png');
  });
});

test.describe('graph, history, settings', () => {
  test('graph view', async ({ page }) => {
    await onboard(page);
    await page.getByRole('button', { name: 'Command palette' }).click();
    await page.getByRole('button', { name: 'Open graph view' }).click();
    await page.locator('canvas').waitFor();
    await page.waitForTimeout(2500); // let the force sim settle

    // The 0.05 pixel tolerance is ~67k px — every node label could vanish unseen.
    // Guard determinism: the canvas must be non-trivially painted (nodes, edges
    // AND the nine labels together paint well past this floor; a blank/label-less
    // canvas falls under it), then compare with a much tighter ratio.
    const painted = await page.locator('canvas').evaluate((c) => {
      const cv = c as HTMLCanvasElement;
      const ctx = cv.getContext('2d');
      if (!ctx) return 0;
      const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
      return n;
    });
    expect(painted).toBeGreaterThan(6000);

    await expect(page).toHaveScreenshot('21-graph.png', { maxDiffPixelRatio: 0.02 });
  });

  test('version history and diff', async ({ page }) => {
    await onboard(page);
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await page.getByRole('button', { name: 'Welcome', exact: true }).click();
    await page.getByRole('button', { name: 'Note menu' }).click();
    await page.getByText('Version history').click();
    await page.locator('.commit').first().waitFor();
    await expect(page).toHaveScreenshot('22-history.png');

    await page.locator('.commit').first().click();
    await page.locator('.diff').waitFor();
    await expect(page).toHaveScreenshot('23-version-diff.png');
  });

  test('settings', async ({ page }) => {
    await onboard(page);
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByText('Sync').first().waitFor();
    await expect(page).toHaveScreenshot('24-settings.png');
  });
});

test.describe('html artifacts', () => {
  test('artifact viewer', async ({ page }) => {
    await onboard(page);
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await page.getByRole('button', { name: 'Sync Pulse html', exact: true }).click();
    const frame = page.frameLocator('.artifact-frame');
    await frame.getByRole('button', { name: 'Pulse 0' }).waitFor();
    // The bars are appended by the artifact's script — wait for all four so the
    // screenshot never catches the sandbox mid-paint (Pulse 0 is static HTML and
    // shows before the script runs).
    await frame.locator('.col').nth(3).waitFor();
    await settle(page);
    await expect(page).toHaveScreenshot('31-artifact-viewer.png');
  });

  test('inline embed in reading view', async ({ page }) => {
    await onboard(page);
    await openShowcase(page);
    // Showcase renders lazy KaTeX + async Mermaid ABOVE the embed; if either is
    // still laying out when we scroll, the embed's offset shifts and the whole
    // frame moves under the capture. Wait for both so the layout above is fixed.
    await page.locator('.katex').first().waitFor({ timeout: 20_000 });
    await page.locator('.mermaid-figure svg').first().waitFor({ timeout: 20_000 });
    const embed = page.locator('.embed--artifact');
    const frame = page.frameLocator('.artifact-frame--embed');
    await frame.getByRole('button', { name: 'Pulse 0' }).waitFor();
    // Wait for all four scripted bars so the screenshot never lands mid-paint
    // (Pulse 0 is static HTML and appears before the sandbox script runs).
    await frame.locator('.col').nth(3).waitFor();
    // Deterministic scroll (layout above is now settled) — scrollIntoViewIfNeeded
    // lands at a variable offset depending on render timing.
    await embed.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await settle(page);
    await expect(page).toHaveScreenshot('32-artifact-embed.png');
  });
});

test.describe('light mode', () => {
  test.use({ colorScheme: 'light' });

  test('empty workspace', async ({ page }) => {
    await onboard(page);
    await expect(page).toHaveScreenshot('25-light-empty.png');
  });

  test('sidebar file tree', async ({ page }) => {
    await onboard(page);
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await page.getByRole('button', { name: 'Welcome' }).waitFor();
    await expect(page).toHaveScreenshot('26-light-sidebar.png');
  });

  test('reading view', async ({ page }) => {
    await onboard(page);
    await openShowcase(page);
    // The Math section is in-frame; wait for KaTeX (lazy chunk) so the capture
    // never freezes the raw-LaTeX Suspense fallback (this baseline was poisoned
    // by exactly that race).
    await page.locator('.katex').first().waitFor({ timeout: 20_000 });
    await settle(page);
    await expect(page).toHaveScreenshot('27-light-note.png');
  });

  test('editor live preview', async ({ page }) => {
    await onboard(page);
    await openShowcase(page);
    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.locator('.cm-content').waitFor();
    await settle(page);
    await expect(page).toHaveScreenshot('28-light-editor.png');
  });

  test('vault menu', async ({ page }) => {
    await onboard(page);
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await page.getByRole('button', { name: /files, .* folders/ }).click();
    await page.locator('.vault-menu').waitFor();
    await expect(page).toHaveScreenshot('29-light-vault-menu.png');
  });
});
