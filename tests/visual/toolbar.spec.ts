import { expect, test, type Page } from '@playwright/test';
import { onboard, swipe } from './helpers';

/**
 * Functional coverage for the Obsidian-mobile editing toolbar (E-8): each button
 * emits the right markdown at the caret, the row scrolls horizontally, it rides
 * editor focus, and a horizontal swipe on it scrolls instead of opening the
 * drawer. Live Preview shows raw markers on the cursor's line, so `.cm-content`
 * reflects what each action inserted.
 */

const bold = (page: Page) => page.getByRole('button', { name: 'Bold', exact: true });
const body = (page: Page) => page.locator('.cm-content');
const firstLine = (page: Page) => page.locator('.cm-line').first();

/** Fresh Untitled note, editor body focused so the toolbar is visible. */
async function newNoteFocused(page: Page): Promise<void> {
  await page.locator('.bottompill').getByRole('button', { name: 'New note' }).click();
  await expect(body(page)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Untitled');
  await body(page).click();
  await expect(bold(page)).toBeVisible();
}

test('bold wraps the selection in **', async ({ page }) => {
  await onboard(page);
  await newNoteFocused(page);
  await page.keyboard.type('hello');
  await page.keyboard.press('ControlOrMeta+a');
  await bold(page).click();
  await expect(body(page)).toContainText('**hello**');
});

test('numbered list prefix toggles on and off', async ({ page }) => {
  await onboard(page);
  await newNoteFocused(page);
  await page.keyboard.type('item');
  const numbered = page.getByRole('button', { name: 'Numbered list' });
  await numbered.click();
  await expect(body(page)).toContainText('1. item');
  await numbered.click();
  expect(await firstLine(page).evaluate((el) => el.textContent)).toBe('item');
});

test('indent and outdent adjust the leading whitespace', async ({ page }) => {
  await onboard(page);
  await newNoteFocused(page);
  await page.keyboard.type('text');
  await page.getByRole('button', { name: 'Indent' }).click();
  expect(await firstLine(page).evaluate((el) => el.textContent)).toMatch(/^\s+text$/);
  await page.getByRole('button', { name: 'Outdent' }).click();
  expect(await firstLine(page).evaluate((el) => el.textContent)).toBe('text');
});

test('quote prefixes the line with "> "', async ({ page }) => {
  await onboard(page);
  await newNoteFocused(page);
  await page.keyboard.type('quoted');
  await page.getByRole('button', { name: 'Quote' }).click();
  await expect(body(page)).toContainText('> quoted');
});

test('markdown link wraps the selection and lands the caret in the url', async ({ page }) => {
  await onboard(page);
  await newNoteFocused(page);
  await page.keyboard.type('Google');
  await page.keyboard.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  // The `url` placeholder is selected, so typing replaces it.
  await page.keyboard.type('x');
  await expect(body(page)).toContainText('[Google](x)');
});

test('tag inserts a # at the caret', async ({ page }) => {
  await onboard(page);
  await newNoteFocused(page);
  await page.getByRole('button', { name: 'Tag' }).click();
  await page.keyboard.type('todo');
  await expect(body(page)).toContainText('#todo');
});

test('embed inserts ![[]] with the caret inside', async ({ page }) => {
  await onboard(page);
  await newNoteFocused(page);
  await page.getByRole('button', { name: 'Embed' }).click();
  await page.keyboard.type('Ghost');
  await page.keyboard.press('Escape'); // dismiss the wikilink autocomplete
  await expect(body(page)).toContainText('![[Ghost]]');
});

test('attachment picker saves the file and inserts an embed', async ({ page }) => {
  await onboard(page);
  await newNoteFocused(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: Buffer.from('89504e47', 'hex'),
  });
  await expect(body(page)).toContainText('![[test.png]]');
});

test('the toolbar row scrolls horizontally', async ({ page }) => {
  await onboard(page);
  await newNoteFocused(page);
  const overflows = await page
    .locator('.editor-toolbar')
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(overflows).toBe(true);
});

test('the toolbar shows only while the editor body is focused', async ({ page }) => {
  await onboard(page);
  await page.locator('.bottompill').getByRole('button', { name: 'New note' }).click();
  await expect(body(page)).toBeVisible();
  // Title is focused, not the body: pill shown, no toolbar.
  await expect(page.locator('.bottompill')).toBeVisible();
  await expect(bold(page)).toHaveCount(0);

  await body(page).click();
  await expect(bold(page)).toBeVisible();
  await expect(page.locator('.bottompill')).toHaveCount(0);

  // Focusing the title blurs the editor: toolbar gone, pill back.
  await page.getByRole('textbox', { name: 'Note title' }).click();
  await expect(bold(page)).toHaveCount(0);
  await expect(page.locator('.bottompill')).toBeVisible();
});

test('a horizontal swipe on the toolbar scrolls it and does not open the drawer', async ({
  page,
}) => {
  await onboard(page);
  await newNoteFocused(page);
  const toolbar = page.locator('.editor-toolbar');
  // Pre-scroll the row to its right end so a rightward (drawer-opening) swipe has
  // room to scroll it back left.
  await toolbar.evaluate((el) => el.scrollTo(el.scrollWidth, 0));
  const before = await toolbar.evaluate((el) => el.scrollLeft);
  expect(before).toBeGreaterThan(0);

  const box = await toolbar.boundingBox();
  if (!box) throw new Error('toolbar not found');
  const y = box.y + box.height / 2;
  await swipe(page, { x: box.x + 40, y }, { x: box.x + box.width - 8, y });

  // The toolbar consumed the horizontal swipe (scrolled), so the drawer stayed shut.
  await expect(page.locator('.sidebar[data-open]')).toHaveCount(0);
  const after = await toolbar.evaluate((el) => el.scrollLeft);
  expect(after).toBeLessThan(before); // positive signal: it scrolled, wasn't the drawer's
});
