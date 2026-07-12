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

// ---------------------------------------------------------------------------
// Frontmatter is source-mode dim/mono, never a display heading (bug 7)
// ---------------------------------------------------------------------------

test('frontmatter renders monospace, never as a Fraunces heading', async ({ page }) => {
  await onboard(page);
  await openInEditor(page, 'Showcase'); // frontmatter: tags: [demo] / status: draft

  // The styled token span wrapping a YAML key line — its font is what regressed
  // (a leading `---` block used to parse as HR + setext-H2 → display face).
  const fmFont = () =>
    page
      .locator('.cm-line', { hasText: 'status: draft' })
      .locator('span')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);

  const liveFont = await fmFont();
  expect(liveFont.toLowerCase()).toContain('mono');
  expect(liveFont).not.toMatch(/Fraunces/i);

  // Same in source mode.
  await body(page).click();
  await page.getByRole('button', { name: 'Switch to source mode' }).click();
  await expect(body(page)).toBeVisible();
  const sourceFont = await fmFont();
  expect(sourceFont.toLowerCase()).toContain('mono');
  expect(sourceFont).not.toMatch(/Fraunces/i);
});

// ---------------------------------------------------------------------------
// Wikilinks inside task / list lines are link-colored (celadon)
// ---------------------------------------------------------------------------

test('a wikilink inside a task line is link-colored, like other list wikilinks', async ({
  page,
}) => {
  await onboard(page);
  // Welcome has "- [ ] Read [[Reading List]]" (task line) and
  // "- A daily note: [[2026-07-02]]" (plain list line). Opening lands the caret
  // at the doc start, so both lines below stay inactive and render their widgets.
  await openInEditor(page, 'Welcome');

  const taskLink = page
    .locator('.cm-line', { has: page.locator('.lp-checkbox') })
    .locator('.lp-wikilink'); // [[Reading List]] inside the checkbox line
  const listLink = page.locator('.lp-wikilink', { hasText: '2026-07-02' });
  await expect(taskLink).toBeVisible();
  await expect(listLink).toBeVisible();

  const taskColor = await taskLink.evaluate((el) => getComputedStyle(el).color);
  const listColor = await listLink.evaluate((el) => getComputedStyle(el).color);
  const bodyColor = await page.locator('.cm-content').evaluate((el) => getComputedStyle(el).color);

  expect(taskColor).toBe(listColor); // same celadon link color as a normal list wikilink
  expect(taskColor).not.toBe(bodyColor); // and distinctly coloured vs plain body text
});

// ---------------------------------------------------------------------------
// Heading anchors survive the editing-mode reroute (caret lands on the heading)
// ---------------------------------------------------------------------------

test('an editing-mode heading link reroutes into the editor with the caret on that heading', async ({
  page,
}) => {
  await onboard(page);
  // 2026-07-02 links to [[Projects/Basalt#Architecture]] (a cross-note heading).
  await openFromTree(page, '2026-07-02'); // X, reading view
  await expect(title(page)).toHaveValue('2026-07-02');

  // Open a second note and switch it to editing so the mode goes global, then
  // step Back into X's (still-reading) history entry with editing mode now on.
  await openFromTree(page, 'Welcome'); // Y, reading (history: empty, X, Y)
  await page.getByRole('button', { name: 'Edit note' }).click(); // editing mode ON
  await expect(body(page)).toBeVisible();
  await page.locator('.bottompill').getByRole('button', { name: 'Back' }).click();
  await expect(title(page)).toHaveValue('2026-07-02'); // back on X, reading view

  // Tap the cross-note heading link: editing mode reroutes it into the editor.
  await page.locator('.md a.wikilink').click();
  await expect(body(page)).toBeVisible();
  await expect(title(page)).toHaveValue('Basalt');

  // The caret landed on "## Architecture": in live preview the cursor line keeps
  // its raw markers, while every other heading hides theirs.
  await expect(page.locator('.cm-line', { hasText: 'Architecture' })).toHaveText('## Architecture');
  await expect(page.locator('.cm-line', { hasText: 'Why' }).first()).toHaveText('Why');
});

// ---------------------------------------------------------------------------
// Checklists (bug notes round 3): toolbar caret, loose lists in reading view,
// checked items sinking to the bottom of their list.
// ---------------------------------------------------------------------------

test('toolbar Task puts the caret after the checkbox; checking an item sinks it', async ({
  page,
}) => {
  await onboard(page);
  await newNoteFocused(page);

  // Toolbar Task on the empty line seeds "- [ ] " with the caret to its RIGHT:
  // typing must land after the box, and Enter continues the list.
  await page.getByRole('button', { name: 'Task', exact: true }).click();
  await page.keyboard.type('alpha');
  await page.keyboard.press('Enter');
  await page.keyboard.type('beta');
  await page.keyboard.press('Enter');
  await page.keyboard.type('gamma');

  const content = () => body(page).evaluate((el) => el.textContent ?? '');
  expect(await content()).toContain('alpha'); // caret fix: not "alpha- [ ]"
  expect((await content()).indexOf('alpha')).toBeLessThan((await content()).indexOf('beta'));

  // Tap alpha's checkbox (an inactive line renders the widget): it checks off
  // and sinks below gamma. The moved line inherits the caret, so live preview
  // shows its raw "- [x]" markers rather than a widget.
  await page.locator('.lp-checkbox').first().click();
  await expect(body(page)).toContainText('[x] alpha');
  const after = await content();
  expect(after.indexOf('beta')).toBeLessThan(after.indexOf('gamma'));
  expect(after.indexOf('gamma')).toBeLessThan(after.indexOf('alpha')); // alpha sank
});

test('a LOOSE checklist renders tappable boxes in reading view — no bullet, no raw checkbox', async ({
  page,
}) => {
  await onboard(page);
  await newNoteFocused(page);

  // "- [ ] alpha", blank line, "- [ ] beta": a LOOSE list. insertText bypasses
  // the list-continuation and bracket-closing keymaps.
  await page.keyboard.insertText('- [ ] alpha\n\n- [ ] beta');
  await expect(body(page)).toContainText('beta');

  // Let the autosave flush before leaving the editor (status leaves "Editing…").
  await expect(page.locator('.workspace-top__status')).not.toHaveText('Editing…');
  await page.getByRole('button', { name: 'Reading view' }).click();
  const tasks = page.locator('.md li.task');
  await expect(tasks).toHaveCount(2);
  // The regression: loose items kept their list bullet AND showed GFM's raw
  // disabled <input> beside the styled box.
  await expect(page.locator('.md input')).toHaveCount(0);
  await expect(page.locator('.md .task__box')).toHaveCount(2);

  // Tapping alpha's box checks it and sinks it below beta.
  await page.locator('.md .task__box').first().click();
  await expect(page.locator('.md li.task[data-checked="true"]')).toHaveCount(1);
  await expect(tasks.last()).toHaveAttribute('data-checked', 'true');
  await expect(tasks.first()).toContainText('beta');
  await expect(tasks.last()).toContainText('alpha');
});
