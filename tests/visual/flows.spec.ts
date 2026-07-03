import { expect, test, type Page } from '@playwright/test';
import { onboard, openSidebarView } from './helpers';

/**
 * Integration flows for note creation and inline-title rename (DOM/behavior
 * assertions only — pixel comparisons live in visual.spec.ts).
 *
 * Contract under test (Obsidian semantics):
 * - Every "new note" entry point is dialog-free and lands in the editor.
 * - Notes created empty and named Untitled(N) open with the title focused and
 *   selected; notes created with a meaningful name (link tap, quick open,
 *   template) do not steal focus into the title.
 * - The inline title IS the filename: Enter/blur commit a rename (sanitized,
 *   deduped, `.md`-stripped, empty reverts), Escape reverts; history entries in
 *   all tabs and inbound wikilinks follow the rename.
 *
 * Regression guard: createNote must index the new note immediately — the
 * search index is a derived cache, and every later index op (autosave replace,
 * rename discard) assumes markdown files are present in it. The fresh-note
 * tests here caught that going wrong once.
 */

const title = (page: Page) => page.getByRole('textbox', { name: 'Note title' });
const editorBody = (page: Page) => page.locator('.cm-content');
const pill = (page: Page) => page.locator('.bottompill');
const treeRow = (page: Page, name: string) =>
  page.locator('.sidebar').getByRole('button', { name, exact: true });

async function openFileTree(page: Page): Promise<void> {
  // Drawers are full-width now: when the sidebar is already open the toggle
  // underneath is covered, so only tap it when the tree isn't showing yet.
  if ((await page.locator('.sidebar[data-open]').count()) === 0) {
    await page.getByRole('button', { name: 'Open sidebar' }).click();
  }
  await expect(page.locator('.sidebar[data-open]')).toBeVisible();
}

/** Open a note from the sidebar file tree into the reading view. */
async function openNoteFromTree(page: Page, name: string): Promise<void> {
  await openFileTree(page);
  await treeRow(page, name).click();
  await expect(title(page)).toBeVisible();
}

/** Create a fresh Untitled note via the bottom pill + button. */
async function newNoteFromPill(page: Page): Promise<void> {
  await pill(page).getByRole('button', { name: 'New note' }).click();
  await expect(editorBody(page)).toBeVisible();
  await expect(title(page)).toHaveValue('Untitled');
}

/** Type a new title and commit it with Enter. */
async function commitTitle(page: Page, value: string): Promise<void> {
  await title(page).fill(value);
  await title(page).press('Enter');
}

// ---------------------------------------------------------------------------
// Creating notes — every entry point, all dialog-free
// ---------------------------------------------------------------------------

test.describe('creating notes', () => {
  test('bottom pill: editor opens on Untitled with the title focused and selected', async ({
    page,
  }) => {
    await onboard(page);
    await newNoteFromPill(page);
    await expect(page.locator('.dialog')).toHaveCount(0);

    // Fresh-note contract: title focused with the whole name selected, so
    // typing immediately names the note.
    await expect(title(page)).toBeFocused();
    const selection = await title(page).evaluate((el) => {
      const t = el as HTMLTextAreaElement;
      return [t.selectionStart, t.selectionEnd];
    });
    expect(selection).toEqual([0, 'Untitled'.length]);

    await openFileTree(page);
    await expect(treeRow(page, 'Untitled')).toBeVisible();
  });

  test('renaming a fresh note commits the rename and moves focus to the body', async ({
    page,
  }) => {
    await onboard(page);
    await newNoteFromPill(page);

    await page.keyboard.type('My Note'); // replaces the selected "Untitled"
    await page.keyboard.press('Enter');
    await expect(title(page)).toHaveValue('My Note');
    await expect(editorBody(page)).toBeFocused(); // Enter jumps into the body

    await openFileTree(page);
    await expect(treeRow(page, 'My Note')).toBeVisible();
    await expect(treeRow(page, 'Untitled')).toHaveCount(0); // no orphan
  });

  test('creating twice without renaming dedupes to Untitled 2', async ({ page }) => {
    await onboard(page);
    await newNoteFromPill(page);

    await pill(page).getByRole('button', { name: 'New note' }).click();
    await expect(title(page)).toHaveValue('Untitled 2');
    await expect(title(page)).toBeFocused(); // Untitled N is still a fresh note

    await openFileTree(page);
    await expect(treeRow(page, 'Untitled')).toBeVisible();
    await expect(treeRow(page, 'Untitled 2')).toBeVisible();
  });

  test('empty-state New note button opens the editor on a fresh Untitled', async ({ page }) => {
    await onboard(page);
    await page.locator('.state').getByRole('button', { name: 'New note' }).click();
    await expect(editorBody(page)).toBeVisible();
    await expect(title(page)).toHaveValue('Untitled');
    await expect(title(page)).toBeFocused();
    await expect(page.locator('.dialog')).toHaveCount(0);
  });

  test('sidebar Files toolbar: New note is dialog-free, New folder still shows its dialog', async ({
    page,
  }) => {
    await onboard(page);
    await openFileTree(page);
    await page.locator('.filetree__toolbar').getByRole('button', { name: 'New note' }).click();
    await expect(editorBody(page)).toBeVisible();
    await expect(title(page)).toHaveValue('Untitled');
    await expect(page.locator('.dialog')).toHaveCount(0);

    // Regression guard: folders have no inline title, so they keep the dialog.
    await openFileTree(page);
    await page.locator('.filetree__toolbar').getByRole('button', { name: 'New folder' }).click();
    await expect(page.getByRole('dialog', { name: 'New folder' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.dialog')).toHaveCount(0);
  });

  test('folder long-press sheet: New note creates inside that folder', async ({ page }) => {
    await onboard(page);
    await openFileTree(page);
    // contextmenu is the long-press path in the tree rows.
    await treeRow(page, 'Projects').click({ button: 'right' });
    await expect(page.locator('.sheet')).toBeVisible();
    await page.locator('.sheet').getByRole('button', { name: 'New note' }).click();

    await expect(editorBody(page)).toBeVisible();
    await expect(title(page)).toHaveValue('Untitled');

    // Nested in Projects: visible while expanded, gone once Projects collapses.
    await openFileTree(page);
    await expect(treeRow(page, 'Untitled')).toBeVisible();
    await treeRow(page, 'Projects').click();
    await expect(treeRow(page, 'Showcase')).toHaveCount(0); // collapse took effect
    await expect(treeRow(page, 'Untitled')).toHaveCount(0);
  });

  test('Today button creates the daily note in the configured folder, reading view', async ({
    page,
  }) => {
    await onboard(page);
    await page.locator('.state').getByRole('button', { name: 'Today' }).click();
    await expect(title(page)).toHaveValue('2026-07-02');
    await expect(page.getByRole('button', { name: 'Edit note' })).toBeVisible(); // reading view

    // Demo vault already has a root 2026-07-02.md; the daily note is a second
    // file (Daily/2026-07-02.md per .obsidian/daily-notes.json).
    await openFileTree(page);
    await expect(treeRow(page, '2026-07-02')).toHaveCount(2);
  });

  test('template flow: editor opens with content, title NOT autofocused', async ({
    page,
  }) => {
    await onboard(page);
    await page.getByRole('button', { name: 'Command palette' }).click();
    await page.getByRole('button', { name: 'New note from template' }).click();
    await page.locator('.quickopen').getByRole('button', { name: 'Meeting' }).click();

    await expect(editorBody(page)).toBeVisible();
    await expect(editorBody(page)).toContainText('Agenda'); // template body applied
    await expect(title(page)).toHaveValue('Untitled');
    // Autofocus exemption: fresh-note focus requires an EMPTY Untitled note.
    await page.waitForTimeout(250); // give a wrongly-triggered autofocus time to fire
    await expect(title(page)).not.toBeFocused();
  });

  test('duplicate: sheet closes and the copy appears in the tree', async ({ page }) => {
    await onboard(page);
    await openFileTree(page);
    await treeRow(page, 'Welcome').click({ button: 'right' });
    await page.locator('.sheet').getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(treeRow(page, 'Welcome copy')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Creating a note from another note
// ---------------------------------------------------------------------------

test.describe('creating from another note', () => {
  test('tapping an unresolved wikilink creates that note; the link then resolves', async ({
    page,
  }) => {
    await onboard(page);
    await openNoteFromTree(page, 'Showcase');
    const unresolved = page.locator('a.wikilink--unresolved', { hasText: 'Future Idea' });
    await unresolved.click();

    // Editor on the new note — named, so the title must NOT be autofocused.
    await expect(editorBody(page)).toBeVisible();
    await expect(title(page)).toHaveValue('Future Idea');
    await page.waitForTimeout(250); // give a wrongly-triggered autofocus time to fire
    await expect(title(page)).not.toBeFocused();

    // Back to Showcase: the link is no longer unresolved.
    await pill(page).getByRole('button', { name: 'Back' }).click();
    const link = page.locator('a.wikilink', { hasText: 'Future Idea' });
    await expect(link).toBeVisible();
    await expect(link).not.toHaveClass(/wikilink--unresolved/);
  });

  test('tapping a missing-note embed creates that note', async ({ page }) => {
    await onboard(page);
    // Seed a note whose body embeds a nonexistent note.
    await page.getByRole('button', { name: 'Quick open' }).click();
    await page.locator('.quickopen .search-input').fill('Embed Host');
    await page.locator('.quickopen .tree-row', { hasText: 'Create "Embed Host"' }).click();
    await expect(editorBody(page)).toBeVisible();

    await editorBody(page).click();
    await page.keyboard.type('![[Ghost Note'); // closeBrackets supplies ]]
    await page.keyboard.press('Escape'); // dismiss the wikilink autocomplete
    // Wait for the autosave so the reading view renders the embed.
    await expect(page.locator('.workspace-top__status')).toHaveText('Embed Host');
    await page.getByRole('button', { name: 'Reading view' }).click();

    await page.locator('button.embed--broken', { hasText: 'Missing note: Ghost Note' }).click();
    await expect(editorBody(page)).toBeVisible();
    await expect(title(page)).toHaveValue('Ghost Note');
  });
});

// ---------------------------------------------------------------------------
// Quick Open creation
// ---------------------------------------------------------------------------

test.describe('quick open', () => {
  async function quickOpen(page: Page, query: string): Promise<void> {
    await page.getByRole('button', { name: 'Quick open' }).click();
    await page.locator('.quickopen .search-input').fill(query);
  }

  test('create row appears for an unmatched query and opens the editor', async ({ page }) => {
    await onboard(page);
    await quickOpen(page, 'Fresh Note');
    await page.locator('.quickopen .tree-row', { hasText: 'Create "Fresh Note"' }).click();
    await expect(editorBody(page)).toBeVisible();
    await expect(title(page)).toHaveValue('Fresh Note');
    await expect(page.locator('.dialog')).toHaveCount(0);
  });

  test('no create row when the query exactly matches an existing note', async ({ page }) => {
    await onboard(page);
    await quickOpen(page, 'Welcome');
    await expect(
      page.locator('.quickopen .tree-row', { hasText: 'Welcome' }).first(),
    ).toBeVisible();
    await expect(page.locator('.quickopen .tree-row', { hasText: 'Create "' })).toHaveCount(0);
  });

  test('a / in the query is a folder path: Projects/Sub Idea creates inside Projects', async ({
    page,
  }) => {
    await onboard(page);
    await quickOpen(page, 'Projects/Sub Idea');
    await page
      .locator('.quickopen .tree-row', { hasText: 'Create "Projects/Sub Idea"' })
      .click();
    await expect(title(page)).toHaveValue('Sub Idea');

    await openFileTree(page);
    await expect(treeRow(page, 'Sub Idea')).toBeVisible();
    await treeRow(page, 'Projects').click(); // collapse
    await expect(treeRow(page, 'Sub Idea')).toHaveCount(0); // it lived inside
  });

  test('Enter with a query nothing matches creates the note', async ({ page }) => {
    await onboard(page);
    await quickOpen(page, 'xqzzy');
    await page.locator('.quickopen .search-input').press('Enter');
    await expect(editorBody(page)).toBeVisible();
    await expect(title(page)).toHaveValue('xqzzy');
  });

  test('Shift+Enter creates even while the query fuzzy-matches an existing note', async ({
    page,
  }) => {
    await onboard(page);
    await quickOpen(page, 'Read');
    // Plain Enter would open the match; Shift+Enter must create "Read" instead.
    await expect(page.locator('.quickopen .tree-row', { hasText: 'Reading List' })).toBeVisible();
    await page.locator('.quickopen .search-input').press('Shift+Enter');
    await expect(editorBody(page)).toBeVisible();
    await expect(title(page)).toHaveValue('Read');

    await openFileTree(page);
    await expect(treeRow(page, 'Read')).toBeVisible();
    await expect(treeRow(page, 'Reading List')).toBeVisible(); // untouched
  });
});

// ---------------------------------------------------------------------------
// Inline-title rename semantics (on demo-vault notes; fresh-note renames are
// exercised in the creation suites above)
// ---------------------------------------------------------------------------

test.describe('renaming via the inline title', () => {
  test('renaming to a taken name in the same folder dedupes; Enter focuses the body', async ({
    page,
  }) => {
    await onboard(page);
    await openNoteFromTree(page, 'Reading List');
    await page.getByRole('button', { name: 'Edit note' }).click();
    await expect(editorBody(page)).toBeVisible();

    await commitTitle(page, 'Welcome'); // Welcome.md already exists at root
    await expect(title(page)).toHaveValue('Welcome 2');
    await expect(editorBody(page)).toBeFocused(); // editor Enter jumps to the body

    await openFileTree(page);
    await expect(treeRow(page, 'Welcome')).toBeVisible();
    await expect(treeRow(page, 'Welcome 2')).toBeVisible();
    await expect(treeRow(page, 'Reading List')).toHaveCount(0);
  });

  test('empty / whitespace-only title reverts without renaming', async ({ page }) => {
    await onboard(page);
    await newNoteFromPill(page);
    await commitTitle(page, '   ');
    await expect(title(page)).toHaveValue('Untitled'); // reverted
    await expect(editorBody(page)).toBeFocused(); // Enter still jumps to the body

    await openFileTree(page);
    await expect(treeRow(page, 'Untitled')).toHaveCount(1);
  });

  test('sanitizes path characters and strips a typed .md extension', async ({ page }) => {
    await onboard(page);
    await openNoteFromTree(page, '2026-07-02');
    await page.getByRole('button', { name: 'Edit note' }).click();
    await expect(editorBody(page)).toBeVisible();

    await commitTitle(page, 'a/b:c');
    await expect(title(page)).toHaveValue('a-b-c');

    await commitTitle(page, 'Name.md');
    await expect(title(page)).toHaveValue('Name'); // no double extension

    await openFileTree(page);
    await expect(treeRow(page, 'Name')).toBeVisible();
    await expect(treeRow(page, 'Name.md')).toHaveCount(0);
    await expect(treeRow(page, 'a-b-c')).toHaveCount(0);
  });

  test('a case-only rename goes through instead of being treated as taken', async ({ page }) => {
    await onboard(page);
    await openNoteFromTree(page, 'Welcome');
    await commitTitle(page, 'welcome');
    await expect(title(page)).toHaveValue('welcome');

    await openFileTree(page);
    await expect(treeRow(page, 'welcome')).toBeVisible();
    await expect(treeRow(page, 'Welcome')).toHaveCount(0);
    await expect(treeRow(page, 'welcome 2')).toHaveCount(0); // not self-deduped
  });

  test('Enter on an unchanged title is a no-op; Escape reverts typed text', async ({ page }) => {
    await onboard(page);
    await openNoteFromTree(page, 'Welcome');
    await page.getByRole('button', { name: 'Edit note' }).click();
    await expect(editorBody(page)).toBeVisible();

    // Unchanged Enter: no rename, no "Welcome 2", focus moves to the body.
    await title(page).click();
    await title(page).press('Enter');
    await expect(editorBody(page)).toBeFocused();
    await expect(title(page)).toHaveValue('Welcome');

    // Escape: revert the draft, blur, rename nothing.
    await title(page).fill('Nonsense');
    await title(page).press('Escape');
    await expect(title(page)).toHaveValue('Welcome');
    await expect(title(page)).not.toBeFocused();

    await openFileTree(page);
    await expect(treeRow(page, 'Welcome')).toBeVisible();
    await expect(treeRow(page, 'Welcome 2')).toHaveCount(0);
    await expect(treeRow(page, 'Nonsense')).toHaveCount(0);
  });

  test('typed body survives an immediate rename; no orphan under the old name', async ({
    page,
  }) => {
    await onboard(page);
    await newNoteFromPill(page);

    await editorBody(page).click();
    await page.keyboard.type('Body content survives the rename.');
    // Rename well inside the autosave debounce window.
    await commitTitle(page, 'Kept Note');
    await expect(title(page)).toHaveValue('Kept Note');
    await expect(editorBody(page)).toContainText('Body content survives the rename.');

    await page.getByRole('button', { name: 'Reading view' }).click();
    await expect(page.locator('.md')).toContainText('Body content survives the rename.');
    await expect(title(page)).toHaveValue('Kept Note');

    await openFileTree(page);
    await expect(treeRow(page, 'Kept Note')).toBeVisible();
    await expect(treeRow(page, 'Untitled')).toHaveCount(0);
  });

  test('a fresh note is full-text searchable after its first autosave', async ({ page }) => {
    await onboard(page);
    await newNoteFromPill(page);
    await editorBody(page).click();
    await page.keyboard.type('xylophone cascade');
    await expect(page.locator('.workspace-top__status')).toHaveText('Untitled'); // autosaved

    await openSidebarView(page, 'Search');
    await page.locator('.search-input').fill('xylophone');
    await expect(page.locator('.sidebar').getByRole('button', { name: /Untitled/ })).toBeVisible();
  });

  test('renaming a linked note rewrites inbound wikilinks in raw source, which still resolve', async ({
    page,
  }) => {
    await onboard(page);
    // Old Note links to [[Welcome]]; rename Welcome from its reading view.
    await openNoteFromTree(page, 'Welcome');
    await commitTitle(page, 'Home Base');
    await expect(title(page)).toHaveValue('Home Base');

    // The rename must rewrite the LITERAL source of the linking note, not just
    // the rendered anchor. Read Old Note's raw markdown in source mode.
    await openNoteFromTree(page, 'Old Note');
    await page.getByRole('button', { name: 'Edit note' }).click();
    await editorBody(page).click();
    await page.getByRole('button', { name: 'Switch to source mode' }).click();
    await expect(editorBody(page)).toContainText('[[Home Base]]');
    await expect(editorBody(page)).not.toContainText('[[Welcome]]'); // old target gone

    // And rendered, the rewritten link resolves and navigates.
    await page.getByRole('button', { name: 'Reading view' }).click();
    const link = page.locator('a.wikilink', { hasText: 'Home Base' });
    await expect(link).toBeVisible();
    await expect(link).not.toHaveClass(/wikilink--unresolved/);
    await link.click();
    await expect(title(page)).toHaveValue('Home Base'); // link followed the rename
  });

  test('renaming a note rewrites inbound ![[embeds]] in raw source too', async ({ page }) => {
    await onboard(page);
    // Reach Projects/Basalt via Welcome's aliased link, then rename it in place.
    await openNoteFromTree(page, 'Welcome');
    await page.locator('a.wikilink', { hasText: 'Basalt project note' }).click();
    await expect(title(page)).toHaveValue('Basalt');
    await commitTitle(page, 'Core Idea');
    await expect(title(page)).toHaveValue('Core Idea');

    // Reading List embeds ![[Projects/Basalt#Why]] — the embed (with its folder
    // and #heading) must be repointed to the new name in the literal source.
    await openNoteFromTree(page, 'Reading List');
    await page.getByRole('button', { name: 'Edit note' }).click();
    await editorBody(page).click();
    await page.getByRole('button', { name: 'Switch to source mode' }).click();
    await expect(editorBody(page)).toContainText('![[Projects/Core Idea#Why]]');
    await expect(editorBody(page)).not.toContainText('Projects/Basalt'); // old embed gone
  });

  test('back/forward history survives a rename in every direction', async ({ page }) => {
    await onboard(page);
    await openNoteFromTree(page, 'Welcome');
    // A -> B through Welcome's aliased link [[Projects/Basalt|Basalt project note]].
    await page.locator('a.wikilink', { hasText: 'Basalt project note' }).click();
    await expect(title(page)).toHaveValue('Basalt');

    await commitTitle(page, 'Basalt Renamed');
    await expect(title(page)).toHaveValue('Basalt Renamed');

    await pill(page).getByRole('button', { name: 'Back' }).click();
    await expect(title(page)).toHaveValue('Welcome');
    // The aliased link kept its display text and still resolves.
    const alias = page.locator('a.wikilink', { hasText: 'Basalt project note' });
    await expect(alias).not.toHaveClass(/wikilink--unresolved/);

    await pill(page).getByRole('button', { name: 'Forward' }).click();
    await expect(title(page)).toHaveValue('Basalt Renamed');
    await expect(page.locator('.md')).toContainText('A beautiful Android markdown vault');
    await expect(page.locator('.state__title')).toHaveCount(0); // no error state
  });

  test('renaming in one tab updates the same note open in another tab', async ({ page }) => {
    await onboard(page);
    await openNoteFromTree(page, 'Welcome'); // tab 1

    await pill(page).getByRole('button', { name: 'Tabs' }).click();
    await page.locator('.sheet').getByRole('button', { name: 'New tab' }).click();
    await openNoteFromTree(page, 'Welcome'); // tab 2, same note

    await commitTitle(page, 'Shared Note');
    await expect(title(page)).toHaveValue('Shared Note');

    await pill(page).getByRole('button', { name: 'Tabs' }).click();
    await expect(page.getByRole('button', { name: 'Close tab Shared Note' })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Close tab Welcome' })).toHaveCount(0);
  });

  test('reading view: Enter commits the rename and blurs the title', async ({ page }) => {
    await onboard(page);
    await openNoteFromTree(page, 'Someday');
    await title(page).click();
    await commitTitle(page, 'Someday Maybe');

    await expect(title(page)).toHaveValue('Someday Maybe');
    await expect(title(page)).not.toBeFocused(); // keyboard dismissed

    await openFileTree(page);
    await expect(treeRow(page, 'Someday Maybe')).toBeVisible();
    await expect(treeRow(page, 'Someday')).toHaveCount(0);
  });

  test('a pipe in the inline title is sanitized to a dash; inbound links still resolve', async ({
    page,
  }) => {
    await onboard(page);
    await openNoteFromTree(page, 'Welcome');
    await commitTitle(page, 'Home|Base');
    await expect(title(page)).toHaveValue('Home-Base'); // | is not path-legal → '-'

    await openFileTree(page);
    await expect(treeRow(page, 'Home-Base')).toBeVisible();
    await expect(treeRow(page, 'Welcome')).toHaveCount(0);

    // Old Note's [[Welcome]] followed the sanitized rename and still resolves.
    await openNoteFromTree(page, 'Old Note');
    const link = page.locator('a.wikilink', { hasText: 'Home-Base' });
    await expect(link).toBeVisible();
    await expect(link).not.toHaveClass(/wikilink--unresolved/);
    await link.click();
    await expect(title(page)).toHaveValue('Home-Base');
  });
});

// ---------------------------------------------------------------------------
// Note ⋮ menu — safe rename and move
// ---------------------------------------------------------------------------

test.describe('note menu rename and move', () => {
  test('Rename onto an existing name dedupes — neither note is destroyed', async ({ page }) => {
    await onboard(page);
    await openNoteFromTree(page, 'Reading List'); // reading view
    await page.getByRole('button', { name: 'Note menu' }).click();
    await page.locator('.sheet').getByRole('button', { name: 'Rename' }).click();
    // Dialog prefilled with "Reading List"; rename it onto the existing "Welcome".
    const dialog = page.getByRole('dialog', { name: 'Rename note' });
    await dialog.locator('input').fill('Welcome');
    await dialog.getByRole('button', { name: 'Rename' }).click();

    await openFileTree(page);
    await expect(treeRow(page, 'Welcome')).toBeVisible(); // the original survives
    await expect(treeRow(page, 'Welcome 2')).toBeVisible(); // ours deduped in
    await expect(treeRow(page, 'Reading List')).toHaveCount(0);

    // The original Welcome's content is intact — this is the note-destruction guard.
    await treeRow(page, 'Welcome').click();
    await expect(title(page)).toHaveValue('Welcome');
    await expect(page.locator('.md')).toContainText('browser demo vault');
  });

  test('Move to folder repoints folder-qualified inbound links; tab history follows', async ({
    page,
  }) => {
    await onboard(page);
    // Reach Projects/Basalt (folder-qualified links point at it) via Welcome.
    await openNoteFromTree(page, 'Welcome');
    await page.locator('a.wikilink', { hasText: 'Basalt project note' }).click();
    await expect(title(page)).toHaveValue('Basalt');

    // Move it to the vault root via the ⋮ menu.
    await page.getByRole('button', { name: 'Note menu' }).click();
    await page.locator('.sheet').getByRole('button', { name: 'Move to folder…' }).click();
    await page.locator('.sheet').getByRole('button', { name: 'Vault root' }).click();

    // Tab history followed the move: still on Basalt, content intact, no error state.
    await expect(title(page)).toHaveValue('Basalt');
    await expect(page.locator('.md')).toContainText('A beautiful Android markdown vault');
    await expect(page.locator('.state__title')).toHaveCount(0);

    // The folder-qualified inbound embed was repointed to the new (root) location.
    await openNoteFromTree(page, 'Reading List');
    await page.getByRole('button', { name: 'Edit note' }).click();
    await editorBody(page).click();
    await page.getByRole('button', { name: 'Switch to source mode' }).click();
    await expect(editorBody(page)).toContainText('![[Basalt#Why]]');
    await expect(editorBody(page)).not.toContainText('Projects/Basalt');
  });
});

// ---------------------------------------------------------------------------
// File actions sheet — folder rename (children move; sibling collision dedupes)
// ---------------------------------------------------------------------------

test.describe('folder rename via the file actions sheet', () => {
  async function renameFolder(page: Page, folder: string, to: string): Promise<void> {
    await openFileTree(page);
    await treeRow(page, folder).click({ button: 'right' }); // long-press sheet
    await expect(page.locator('.sheet')).toBeVisible();
    await page.locator('.sheet').getByRole('button', { name: 'Rename' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename folder' });
    await dialog.locator('input').fill(to);
    await dialog.getByRole('button', { name: 'Rename' }).click();
  }

  test('happy path: the folder renames and its children move with it', async ({ page }) => {
    await onboard(page);
    await renameFolder(page, 'Archive', 'Vault Archive');

    await openFileTree(page);
    await expect(treeRow(page, 'Vault Archive')).toBeVisible();
    await expect(treeRow(page, 'Archive')).toHaveCount(0);
    // The child note moved with the folder and still opens with its content.
    await treeRow(page, 'Old Note').click();
    await expect(title(page)).toHaveValue('Old Note');
    await expect(page.locator('.md')).toContainText('lives in the archive');
  });

  test('onto a sibling name it dedupes to "Projects 2"; nothing is lost', async ({ page }) => {
    await onboard(page);
    // A sibling folder "Projects" already exists at the root.
    await renameFolder(page, 'Archive', 'Projects');

    await openFileTree(page);
    await expect(treeRow(page, 'Projects 2')).toBeVisible(); // deduped folder
    await expect(treeRow(page, 'Old Note')).toBeVisible(); // moved child, not lost
    await expect(treeRow(page, 'Basalt')).toBeVisible(); // original Projects intact
    await expect(treeRow(page, 'Showcase')).toBeVisible();
    // The moved child really lives at its new path.
    await treeRow(page, 'Old Note').click();
    await expect(title(page)).toHaveValue('Old Note');
  });
});

// ---------------------------------------------------------------------------
// Settings-driven flows: templates, default new-note location, add-vault
// ---------------------------------------------------------------------------

test.describe('settings-driven flows', () => {
  async function openSettings(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByText('Sync').first().waitFor();
  }

  test('Settings shows a Templates section and accepts a template folder', async ({ page }) => {
    await onboard(page);
    await openSettings(page);

    const templates = page.locator('.group', { hasText: 'Templates' });
    await expect(templates.getByText('Template folder location')).toBeVisible();
    const input = templates.locator('input');
    await input.fill('templates');
    await input.press('Enter');
    await expect(input).toHaveValue('templates');
  });

  test('palette Insert template drops the template at the caret with {{date}} filled', async ({
    page,
  }) => {
    await onboard(page);
    // Open a note in the editor, but do NOT focus the body — the bottom pill
    // (and its command palette) is only shown while the editor is unfocused.
    await openNoteFromTree(page, 'Someday');
    await page.getByRole('button', { name: 'Edit note' }).click();
    await expect(editorBody(page)).toBeVisible();

    await page.getByRole('button', { name: 'Command palette' }).click();
    await page.getByRole('button', { name: 'Insert template' }).click();
    await page.getByText('Insert a template').waitFor();
    await page.locator('.quickopen').getByRole('button', { name: 'Meeting' }).click();

    // The Meeting template body landed in the open note; {{date}} → the fixed date.
    await expect(editorBody(page)).toContainText('Date: 2026-07-02');
    await expect(editorBody(page)).toContainText('Agenda');
  });

  test('default new-note location = folder: bottom-pill New note lands inside it', async ({
    page,
  }) => {
    await onboard(page);
    await openSettings(page);

    const group = page.locator('.group', { hasText: 'New notes' });
    await group.getByRole('button', { name: 'Folder', exact: true }).click();
    const folderInput = group.locator('.setting', { hasText: 'New note folder' }).locator('input');
    await folderInput.fill('Projects');
    await folderInput.press('Enter');

    await page.getByRole('button', { name: 'Back' }).click(); // back to the workspace
    await newNoteFromPill(page); // creates Untitled in the configured default folder
    await expect(title(page)).toHaveValue('Untitled');

    await openFileTree(page);
    await expect(treeRow(page, 'Untitled')).toBeVisible();
    await treeRow(page, 'Projects').click(); // collapse Projects…
    await expect(treeRow(page, 'Untitled')).toHaveCount(0); // …the note lived inside it
  });

  test('Add vault with saved credentials asks only for the repository', async ({ page }) => {
    await onboard(page);
    await openSettings(page);
    await page.getByRole('button', { name: /Add vault/ }).click();

    // Connect step in reuse-credentials mode: repository field + PAT reminder only.
    // (exact: true so the reminder's own "…and access token" copy can't match.)
    await expect(page.getByText('Add a vault')).toBeVisible(); // header title
    await expect(page.getByText('Repository', { exact: true })).toBeVisible();
    await expect(page.getByText('GitHub username', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Access token', { exact: true })).toHaveCount(0);
    await expect(page.locator('input[type=password]')).toHaveCount(0); // no token input
    await expect(page.getByText(/token can reach this repository/i)).toBeVisible();

    // The escape hatch reveals the full credential form.
    const escape = page.getByRole('button', { name: 'Use a different account or token' });
    await expect(escape).toBeVisible();
    await escape.click();
    await expect(page.getByText('GitHub username', { exact: true })).toBeVisible();
    await expect(page.getByText('Access token', { exact: true })).toBeVisible();
    await expect(page.locator('input[type=password]')).toHaveCount(1);
  });
});
