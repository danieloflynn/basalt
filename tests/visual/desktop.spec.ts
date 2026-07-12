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
  // No pane title on desktop (Obsidian parity) — just the empty-state hint.
  await expect(page.locator('.sidebar-right')).toContainText('No backlinks');
  // Ribbon: always-visible left icon strip with one button per global command.
  await expect(page.locator('.ribbon')).toBeVisible();
  await expect(page.locator('.ribbon__item')).toHaveCount(5);
  // Titlebar view-switcher cluster only shows while the sidebar is docked open.
  await expect(page.locator('.titlebar-switcher')).toBeVisible();
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
  // Obsidian-parity chrome: per-pane header + bottom-right status bar.
  await expect(page.locator('.pane-header')).toBeVisible();
  await expect(page.locator('.status-bar')).toBeVisible();
  await expect(page.locator('.status-bar')).toHaveText(/\d+ words/);
  await settle(page);
  await expect(page).toHaveScreenshot('desktop-02-note.png');
});

test('right-clicking a file row opens a compact context menu, not the bottom sheet', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click({ button: 'right' });
  await expect(page.locator('.ctx-menu')).toBeVisible();
  await expect(page.locator('.ctx-menu')).toContainText('Rename');
  await expect(page.locator('.sheet')).toHaveCount(0);
  // Click-away (on note body whitespace) closes it without opening anything.
  await page.mouse.click(640, 500);
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
});

test('the pane ⋮ button opens an anchored note menu on desktop', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  await page.getByRole('button', { name: 'Note menu' }).click();
  await expect(page.locator('.ctx-menu')).toBeVisible();
  await expect(page.locator('.ctx-menu')).toContainText('Local graph');
  await expect(page.locator('.sheet')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
});

test('collapsing the backlinks panel widens the centre column', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle backlinks' }).click();
  await expect(page.locator('.shell[data-desktop][data-right]')).toHaveCount(0);
  await settle(page);
  await expect(page).toHaveScreenshot('desktop-03-note-wide.png');
});

/**
 * WP7: the desktop "Linked mentions" panel — one collapsible group per
 * source note (chevron + title + count badge), boxed mention snippets, and
 * a header "Collapse results" toggle that folds/unfolds every group at once.
 */
test('linked mentions renders one group per source note with a boxed snippet', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  const panel = page.locator('.sidebar-right');
  await expect(panel).toContainText('Linked mentions');
  // Welcome's three backlinks (Reading List, Old Note, Sync Pulse artifact).
  await expect(panel.locator('.rightbar__group')).toHaveCount(3);
  // Anchor on the group TITLE, not subtree text — the Sync Pulse group's
  // snippet also contains the words "Reading List".
  const readingList = panel.locator('.rightbar__group', {
    has: page.locator('.rightbar__group-title', { hasText: 'Reading List' }),
  });
  await expect(readingList.locator('.rightbar__mention')).toHaveCount(1);
  await expect(readingList.locator('.rightbar__group-count')).toHaveText('1');
});

test('clicking a group chevron collapses only that group, without navigating', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  const panel = page.locator('.sidebar-right');
  // Title-anchored (snippet text may name other notes — see above).
  const readingList = panel.locator('.rightbar__group', {
    has: page.locator('.rightbar__group-title', { hasText: 'Reading List' }),
  });
  const oldNote = panel.locator('.rightbar__group', {
    has: page.locator('.rightbar__group-title', { hasText: 'Old Note' }),
  });
  await readingList.locator('.rightbar__group-chevron').click();
  await expect(readingList.locator('.rightbar__mention')).toHaveCount(0);
  // A sibling group is untouched, and we never left the Welcome note.
  await expect(oldNote.locator('.rightbar__mention')).toHaveCount(1);
  await expect(page.locator('.inline-title')).toHaveValue('Welcome');
  // Clicking the chevron again reopens it.
  await readingList.locator('.rightbar__group-chevron').click();
  await expect(readingList.locator('.rightbar__mention')).toHaveCount(1);
});

/**
 * WP8: the desktop file-explorer header — Obsidian-parity icon-only row
 * (new note / new folder / sort / collapse-all) replacing the mobile A–Z
 * text pill. Structural coverage only; desktop-01/02/03 already cover its
 * appearance visually.
 */
test('the file-explorer header is icon-only on desktop, with a sort menu and collapse-all', async ({
  page,
}) => {
  await onboard(page);
  const toolbar = page.locator('.filetree__toolbar--desktop');
  await expect(toolbar).toBeVisible();
  // Icon-only — no leftover "A–Z"/"Recent" text pill from the mobile header.
  await expect(toolbar).not.toContainText('A–Z');
  await expect(toolbar).not.toContainText('Recent');
  await expect(toolbar.getByRole('button', { name: 'New note' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'New folder' })).toBeVisible();

  // Sort menu: anchored popup listing both sort orders, checkmark on the
  // active one, reusing the same .ctx-menu/.sheet__item the context menus use.
  await page.getByRole('button', { name: 'Change sort order' }).click();
  const menu = page.locator('.ctx-menu');
  await expect(menu).toBeVisible();
  const byName = page.getByRole('menuitemradio', { name: /Name \(A to Z\)/ });
  const byModified = page.getByRole('menuitemradio', { name: /Recently modified/ });
  await expect(byName).toHaveAttribute('aria-checked', 'true');
  await expect(byModified).toHaveAttribute('aria-checked', 'false');
  await byModified.click();
  await expect(menu).toHaveCount(0);

  // Reopening confirms the choice persisted and the checkmark followed it.
  await page.getByRole('button', { name: 'Change sort order' }).click();
  await expect(page.getByRole('menuitemradio', { name: /Recently modified/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('.ctx-menu')).toHaveCount(0);

  // Collapse-all folds every folder and flips to "Expand all"; toggling again
  // (with nothing collapsed by the user in between) clears the set.
  await expect(page.locator('.tree-row--folder').first()).toBeVisible();
  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expect(page.locator('.tree-row--folder .tree-row__chevron').first()).toHaveCSS(
    'transform',
    'none',
  );
  await expect(page.getByRole('button', { name: 'Expand all' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.getByRole('button', { name: 'Collapse all' })).toBeVisible();
});

test('clicking a group title still opens the source note', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  await page
    .locator('.sidebar-right .rightbar__group-title', { hasText: 'Reading List' })
    .click();
  await expect(page.locator('.inline-title')).toHaveValue('Reading List');
});

test('the header "Collapse results" button folds and unfolds every group', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  const panel = page.locator('.sidebar-right');
  const collapseAll = page.getByRole('button', { name: 'Collapse results' });
  await expect(panel.locator('.rightbar__mention')).toHaveCount(3);
  await collapseAll.click();
  await expect(panel.locator('.rightbar__mention')).toHaveCount(0);
  await collapseAll.click();
  await expect(panel.locator('.rightbar__mention')).toHaveCount(3);
});

/**
 * WP9: right-sidebar icon tabs (Backlinks | Outline) and the collapsed-by-
 * default "Unlinked mentions" section under the linked ones.
 */
test('the right sidebar switches between backlinks and outline tabs', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  // Backlinks is the default tab.
  await expect(page.getByRole('tab', { name: 'Backlinks' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.sidebar-right')).toContainText('Linked mentions');

  await page.getByRole('tab', { name: 'Outline' }).click();
  const items = page.locator('.rightbar__outline-item');
  await expect(items).toHaveText(['Welcome to Basalt', 'Try things', 'Tasks']);
  // Clicking a heading scrolls the reader to it without leaving the note.
  await items.nth(2).click();
  await expect(page.locator('.inline-title')).toHaveValue('Welcome');
  await expect
    .poll(() => page.locator('.scroll').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
});

test('unlinked mentions lists notes that mention the title without linking to it', async ({
  page,
}) => {
  await onboard(page);
  // Pristine demo vault: nothing mentions "Welcome" without also linking it.
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  await expect(page.locator('.sidebar-right')).toContainText('Linked mentions');
  await expect(page.locator('.rightbar__unlinked')).toHaveCount(0);

  // Type a plain-text mention of "Someday" (no wikilink) into another note,
  // then open Someday: the autosaved edit must surface as an unlinked mention.
  await page.locator('.filetree').getByRole('button', { name: 'Old Note', exact: true }).click();
  await page.getByRole('button', { name: 'Edit note' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.type(' Someday plans. ');
  await page.locator('.filetree').getByRole('button', { name: 'Someday', exact: true }).click();

  const unlinked = page.locator('.rightbar__unlinked');
  await expect(unlinked).toContainText('Unlinked mentions');
  await expect(unlinked.locator('.rightbar__group-count').first()).toHaveText('1');
  // Collapsed by default (Obsidian's default); expanding reveals the source
  // and its snippet with the matched title marked.
  await expect(unlinked.locator('.rightbar__mention')).toHaveCount(0);
  await unlinked.locator('.rightbar__group-head').first().click();
  await expect(unlinked.locator('.rightbar__mention')).toHaveCount(1);
  await expect(unlinked.locator('.rightbar__mention mark')).toHaveText('Someday');
});

/**
 * WP10: the desktop reader's expanded properties table is editable in place
 * (Obsidian parity) — edit a scalar value, add/remove array items, and
 * add/delete whole properties, all writing through vaultService. Uses the
 * demo vault's Welcome note (title/tags/created frontmatter).
 */
function propRow(page: import('@playwright/test').Page, key: string) {
  return page.locator('.props-expanded__row', {
    has: page.locator('.props-expanded__key', { hasText: key }),
  });
}

test('editing a scalar property value writes through and survives navigating away and back', async ({
  page,
}) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  const titleValue = propRow(page, 'title').locator('.props-expanded__value--edit');
  await expect(titleValue).toHaveText('Welcome');

  await titleValue.click();
  const input = page.locator('.props-expanded__value-input');
  await input.fill('Welcome Edited');
  await input.press('Enter');
  await expect(propRow(page, 'title').locator('.props-expanded__value--edit')).toHaveText(
    'Welcome Edited',
  );

  // Navigate away and back — this only shows fresh content if the edit
  // actually persisted through vaultService.writeNote, not just local state.
  // Scoped to the file tree: "Reading List" is also a backlink group title
  // in the right sidebar for this note.
  await page.locator('.filetree').getByRole('button', { name: 'Reading List', exact: true }).click();
  await expect(page.locator('.inline-title')).toHaveValue('Reading List');
  await page.locator('.filetree').getByRole('button', { name: 'Welcome', exact: true }).click();
  await expect(propRow(page, 'title').locator('.props-expanded__value--edit')).toHaveText(
    'Welcome Edited',
  );
});

test('adding a new property makes it appear, and deleting it removes it', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();

  await page.locator('.props-expanded__add').click();
  await page.getByLabel('Property name').fill('priority');
  await page.getByLabel('Property value').fill('high');
  await page.getByLabel('Property value').press('Enter');

  const row = propRow(page, 'priority');
  await expect(row).toBeVisible();
  await expect(row.locator('.props-expanded__value--edit')).toHaveText('high');

  await row.locator('.props-expanded__delete').click();
  await expect(propRow(page, 'priority')).toHaveCount(0);
});

test('adding and removing a tags array item writes through', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();

  const tagsRow = propRow(page, 'tags');
  await expect(tagsRow.locator('.props-expanded__tag')).toHaveCount(2); // basalt, demo

  const addInput = tagsRow.locator('.props-expanded__tag-input');
  await addInput.fill('newtag');
  await addInput.press('Enter');
  await expect(tagsRow.locator('.props-expanded__tag')).toHaveCount(3);
  await expect(tagsRow).toContainText('newtag');

  await tagsRow.getByRole('button', { name: 'Remove newtag' }).click();
  await expect(tagsRow.locator('.props-expanded__tag')).toHaveCount(2);
  await expect(tagsRow).not.toContainText('newtag');
});

/**
 * Desktop graph view: pane-header chrome (not the mobile circular back
 * button) and the settings panel as a floating card without a scrim.
 */
test('the graph view uses the pane header and a floating settings card', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Graph view' }).click(); // ribbon
  await expect(page.locator('.pane-header')).toBeVisible();
  await expect(page.locator('.pane-header')).toContainText('Graph view');
  await expect(page.locator('.workspace-top')).toHaveCount(0);

  await page.getByRole('button', { name: 'Graph settings' }).click();
  const panel = page.locator('.graph-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Filters');
  // No scrim on desktop — the card floats while the canvas stays usable.
  await expect(page.locator('.graph-panel__scrim')).not.toBeVisible();
  await page.getByRole('button', { name: 'Close graph settings' }).click();
  await expect(panel).toHaveCount(0);
});

/**
 * Linked mentions show real per-source occurrence counts: a source linking
 * twice gets a "2" badge and one boxed snippet per occurrence, and the
 * "Linked mentions" header total counts occurrences, not source notes.
 */
test('a source linking twice shows count 2 and two snippets', async ({ page }) => {
  await onboard(page);
  // Old Note already links [[Welcome]] once; type two more links into it.
  await page.locator('.filetree').getByRole('button', { name: 'Old Note', exact: true }).click();
  await page.getByRole('button', { name: 'Edit note' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.type(' Also [[Welcome]] and [[Welcome]] again. ');

  await page.locator('.filetree').getByRole('button', { name: 'Welcome', exact: true }).click();
  const panel = page.locator('.sidebar-right');
  const oldNote = panel.locator('.rightbar__group', {
    has: page.locator('.rightbar__group-title', { hasText: 'Old Note' }),
  });
  await expect(oldNote.locator('.rightbar__group-count')).toHaveText('3');
  await expect(oldNote.locator('.rightbar__mention')).toHaveCount(3);
  // Header total = occurrences across all sources: Old Note 3 + Reading List 1
  // + Sync Pulse artifact 1.
  await expect(panel.locator('.rightbar__total')).toHaveText('5');
});

/**
 * Pinned tabs (Obsidian): right-click a tab to pin it — a pin badge replaces
 * the close button, navigation opens a NEW tab beside it instead of replacing
 * its note, and Close in the context menu is disabled until unpinned.
 */
test('pinning a tab locks its note and routes navigation to a new tab', async ({ page }) => {
  await onboard(page);
  await page.locator('.filetree').getByRole('button', { name: 'Welcome', exact: true }).click();

  const welcomeTab = page.locator('.desktop-tab', { hasText: 'Welcome' });
  await welcomeTab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unpin Welcome' })).toBeVisible();

  // Navigating from the pinned tab spawns a fresh tab beside it.
  await page.locator('.filetree').getByRole('button', { name: 'Reading List', exact: true }).click();
  await expect(page.locator('.desktop-tab')).toHaveCount(2);
  await expect(page.locator('.desktop-tab[data-active]')).toContainText('Reading List');
  await expect(welcomeTab).toContainText('Welcome');

  // Close is disabled on the pinned tab's menu.
  await welcomeTab.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Close' })).toBeDisabled();
  await page.keyboard.press('Escape');

  // Clicking the pin badge unpins: the close button comes back.
  await page.getByRole('button', { name: 'Unpin Welcome' }).click();
  await expect(page.getByRole('button', { name: 'Close Welcome' })).toBeVisible();
});
