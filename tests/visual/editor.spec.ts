import { expect, test, type Page } from '@playwright/test';
import { onboard } from './helpers';

/**
 * Functional coverage for the live-preview editor after the S24 fixes:
 * task lines render as a single checkbox (no leading "- "), bullets get a dot
 * with a hanging indent, source mode stays raw, wikilink autocomplete inserts
 * exactly one "]]" pair, the toolbar's [[]] deletes as a pair, headings share
 * the reading view's display font, and the edit/read toggle is sticky.
 */

const body = (page: Page) => page.locator('.cm-content');
const title = (page: Page) => page.getByRole('textbox', { name: 'Note title' });
const firstLine = (page: Page) => page.locator('.cm-line').first();

/** Open a note from the file tree (reading view under the default mode). */
async function openFromTree(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect(page.locator('.sidebar[data-open]')).toBeVisible();
  await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
}

/** Open a note and switch it into the (live) editor. */
async function openInEditor(page: Page, name: string): Promise<void> {
  await openFromTree(page, name);
  await page.getByRole('button', { name: 'Edit note' }).click();
  await expect(body(page)).toBeVisible();
}

/** Fresh Untitled note with the editor body focused (toolbar visible). */
async function newNoteFocused(page: Page): Promise<void> {
  await page.locator('.bottompill').getByRole('button', { name: 'New note' }).click();
  await expect(body(page)).toBeVisible();
  await expect(title(page)).toHaveValue('Untitled');
  await body(page).click();
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Task checkboxes (bug 1)
// ---------------------------------------------------------------------------

test('live preview renders a task line as a checkbox only, no "- " marker', async ({ page }) => {
  await onboard(page);
  await openInEditor(page, '2026-07-02'); // has one "- [ ] Ship the sync engine"

  const checkbox = page.locator('.lp-checkbox');
  await expect(checkbox).toHaveCount(1);
  await expect(checkbox).toHaveAttribute('data-checked', 'false');

  // The task line shows the widget alone — no raw "- [ ]" survives as text.
  const taskLine = page.locator('.cm-line', { has: page.locator('.lp-checkbox') });
  const text = (await taskLine.first().evaluate((el) => el.textContent)) ?? '';
  expect(text).not.toMatch(/[[\]]/); // no bracket chars
  expect(text.trimStart().startsWith('-')).toBe(false); // no bullet hyphen
  expect(text).toContain('Ship the sync engine');

  // Tapping the box toggles the source (space -> x) without stranding a marker.
  await checkbox.click();
  await expect(checkbox).toHaveAttribute('data-checked', 'true');
});

test('source mode keeps the raw task markers and drops the checkbox widget', async ({ page }) => {
  await onboard(page);
  await openInEditor(page, '2026-07-02');
  await body(page).click(); // focus reveals the toolbar (with the mode toggle)
  await page.getByRole('button', { name: 'Switch to source mode' }).click();

  await expect(page.locator('.lp-checkbox')).toHaveCount(0);
  await expect(body(page)).toContainText('- [ ] Ship the sync engine');
});

// ---------------------------------------------------------------------------
// List formatting (bug 2)
// ---------------------------------------------------------------------------

test('bullets render as a dot with a hanging indent in live preview', async ({ page }) => {
  await onboard(page);
  await openInEditor(page, 'Reading List'); // two "- …" bullets

  const bullet = page.locator('.lp-bullet');
  await expect(bullet.first()).toBeVisible();
  expect(await bullet.first().evaluate((el) => el.textContent)).toBe('•');

  // Hanging indent is applied as an inline style on the list line.
  const style = (await page.locator('.cm-lp-list').first().getAttribute('style')) ?? '';
  expect(style).toContain('padding-left');
  expect(style).toContain('text-indent');
});

// ---------------------------------------------------------------------------
// Wikilink autocomplete (bug 3)
// ---------------------------------------------------------------------------

test('wikilink autocomplete inserts exactly one closing pair, caret after it', async ({ page }) => {
  await onboard(page);
  await newNoteFocused(page);

  await page.keyboard.type('[[Welc'); // closeBrackets already supplied "]]"
  const option = page.locator('.cm-tooltip-autocomplete li').filter({ hasText: 'Welcome' }).first();
  await expect(option).toBeVisible();
  await option.click();

  // Caret sits after the single "]]": the typed "!" lands outside the link.
  await page.keyboard.type('!');
  expect(await firstLine(page).evaluate((el) => el.textContent)).toBe('[[Welcome]]!');
});

// ---------------------------------------------------------------------------
// Bracket-pair backspace (bug 4)
// ---------------------------------------------------------------------------

test('toolbar [[]] then Backspace clears the pair instead of stranding ]]', async ({ page }) => {
  await onboard(page);
  await newNoteFocused(page);

  await page.getByRole('button', { name: 'Wikilink' }).click();
  await expect(body(page)).toContainText('[[]]');

  await page.keyboard.press('Backspace'); // deletes the inner pair
  expect(await firstLine(page).evaluate((el) => el.textContent)).toBe('[]');

  await page.keyboard.press('Backspace'); // deletes the outer pair
  const left = (await firstLine(page).evaluate((el) => el.textContent)) ?? '';
  expect(left).not.toMatch(/[[\]]/); // no stray brackets
});

// ---------------------------------------------------------------------------
// Universal editing mode (bug 5)
// ---------------------------------------------------------------------------

test('editing mode is sticky across notes; toggling back is too', async ({ page }) => {
  await onboard(page);

  // Note A opens reading; toggle it to edit -> the mode goes global.
  await openFromTree(page, 'Welcome');
  await page.getByRole('button', { name: 'Edit note' }).click();
  await expect(body(page)).toBeVisible();

  // Note B, opened from the sidebar, now lands directly in the editor.
  await openFromTree(page, 'Reading List');
  await expect(body(page)).toBeVisible();
  await expect(title(page)).toHaveValue('Reading List');

  // Flip back to reading on B; the default follows.
  await page.getByRole('button', { name: 'Reading view' }).click();
  await expect(page.getByRole('button', { name: 'Edit note' })).toBeVisible();

  // Note C opens in the reader again.
  await openFromTree(page, '2026-07-02');
  await expect(page.getByRole('button', { name: 'Edit note' })).toBeVisible();
  await expect(page.locator('.md')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Heading font parity (bug 6)
// ---------------------------------------------------------------------------

test('editor headings use the reading view font family', async ({ page }) => {
  await onboard(page);
  await openFromTree(page, '2026-07-02');

  const readingFont = await page
    .locator('.md h1')
    .evaluate((el) => getComputedStyle(el).fontFamily);

  await page.getByRole('button', { name: 'Edit note' }).click();
  await expect(body(page)).toBeVisible();
  const editorFont = await page
    .locator('.cm-lp-h1')
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);

  expect(editorFont).toBe(readingFont);
});
