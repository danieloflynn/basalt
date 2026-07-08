import { expect, test, type Page } from '@playwright/test';
import { onboard } from './helpers';

/**
 * HTML artifacts: .html files in the vault are first-class citizens — they
 * open from the file tree, wikilinks and markdown links into a sandboxed
 * viewer (srcdoc iframe, no same-origin access), and ![[page.html]] embeds
 * render inline in reading view.
 */

const treeRow = (page: Page, name: string) =>
  page.locator('.sidebar').getByRole('button', { name, exact: true });

async function openFileTree(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect(page.locator('.sidebar[data-open]')).toBeVisible();
}

test.describe('html artifacts', () => {
  test('opens from the file tree; scripts run inside the sandbox', async ({ page }) => {
    await onboard(page);
    await openFileTree(page);
    await treeRow(page, 'Sync Pulse html').click();

    // Viewer chrome: name in the top bar, sandboxed frame below.
    await expect(page.locator('.workspace-top__status')).toHaveText('Sync Pulse');
    const frame = page.frameLocator('.artifact-frame');
    await expect(frame.getByRole('heading', { name: 'Sync Pulse' })).toBeVisible();

    // The artifact's own script is live: the counter increments on tap.
    await frame.getByRole('button', { name: 'Pulse 0' }).click();
    await expect(frame.getByRole('button', { name: 'Pulse 1' })).toBeVisible();

    // Reload remounts the frame — the artifact's state resets.
    await page.getByRole('button', { name: 'Reload artifact' }).click();
    await expect(frame.getByRole('button', { name: 'Pulse 0' })).toBeVisible();
  });

  test('a wikilink to an .html file opens the viewer; back returns to the note', async ({
    page,
  }) => {
    await onboard(page);
    await openFileTree(page);
    await treeRow(page, 'Welcome').click();
    await expect(page.getByRole('textbox', { name: 'Note title' })).toBeVisible();

    await page.locator('a.wikilink', { hasText: 'Sync Pulse' }).click();
    await expect(page.locator('.artifact-frame')).toBeVisible();
    await expect(page.locator('.workspace-top__status')).toHaveText('Sync Pulse');

    await page.locator('.bottompill').getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Welcome');
  });

  test('![[page.html]] renders a sandboxed inline embed with a jump to the viewer', async ({
    page,
  }) => {
    await onboard(page);
    await openFileTree(page);
    await treeRow(page, 'Showcase').click();
    await expect(page.getByRole('textbox', { name: 'Note title' })).toBeVisible();

    const embed = page.locator('.embed--artifact');
    await embed.scrollIntoViewIfNeeded();
    await expect(embed.locator('.embed__title--artifact')).toContainText('Sync Pulse');
    const frame = page.frameLocator('.artifact-frame--embed');
    await expect(frame.getByRole('heading', { name: 'Sync Pulse' })).toBeVisible();

    await embed.getByRole('button', { name: 'Open' }).click();
    await expect(page.locator('.artifact-frame')).toBeVisible();
    await expect(page.locator('.workspace-top__status')).toHaveText('Sync Pulse');
  });

  test('artifact tabs are labeled by name; tree row highlights the active artifact', async ({
    page,
  }) => {
    await onboard(page);
    await openFileTree(page);
    await treeRow(page, 'Sync Pulse html').click();
    await expect(page.locator('.artifact-frame')).toBeVisible();

    await openFileTree(page);
    await expect(treeRow(page, 'Sync Pulse html')).toHaveClass(/tree-row--active/);
    await treeRow(page, 'Sync Pulse html').click(); // navigating closes the sidebar

    await page.locator('.bottompill').getByRole('button', { name: 'Tabs' }).click();
    await expect(page.getByRole('button', { name: 'Close tab Sync Pulse' })).toBeVisible();
  });
});
