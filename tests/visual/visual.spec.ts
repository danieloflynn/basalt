import { expect, test, type Page } from '@playwright/test';
import { FIXED_TIME, onboard, openSidebarView, settle } from './helpers';

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
    await page.locator('.cm-content').click();
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
});

test.describe('graph, history, settings', () => {
  test('graph view', async ({ page }) => {
    await onboard(page);
    await page.getByRole('button', { name: 'Command palette' }).click();
    await page.getByRole('button', { name: 'Open graph view' }).click();
    await page.locator('canvas').waitFor();
    await page.waitForTimeout(2500); // let the force sim settle
    await expect(page).toHaveScreenshot('21-graph.png', { maxDiffPixelRatio: 0.05 });
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
