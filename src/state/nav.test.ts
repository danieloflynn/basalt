import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentScreen, focusedScreen, openNote, tabLabel, useNav } from './nav';

const nav = () => useNav.getState();

describe('nav history', () => {
  beforeEach(() => nav().reset());

  it('pushes, goes back, and forward', () => {
    nav().push({ name: 'note', path: 'a.md' });
    nav().push({ name: 'note', path: 'b.md' });
    expect(currentScreen(nav())).toEqual({ name: 'note', path: 'b.md' });

    expect(nav().back()).toBe(true);
    expect(currentScreen(nav())).toEqual({ name: 'note', path: 'a.md' });
    expect(nav().canForward()).toBe(true);

    expect(nav().forward()).toBe(true);
    expect(currentScreen(nav())).toEqual({ name: 'note', path: 'b.md' });
    expect(nav().forward()).toBe(false);
  });

  it('truncates forward history on a new push', () => {
    nav().push({ name: 'note', path: 'a.md' });
    nav().push({ name: 'note', path: 'b.md' });
    nav().back();
    nav().push({ name: 'settings' });
    expect(nav().canForward()).toBe(false);
    expect(nav().back()).toBe(true);
    expect(currentScreen(nav())).toEqual({ name: 'note', path: 'a.md' });
  });

  it('back drains overlay, then sidebar, then history, then gives up', () => {
    nav().push({ name: 'note', path: 'a.md' });
    nav().openSidebar();
    nav().setOverlay('quickopen');

    expect(nav().back()).toBe(true); // closes the overlay
    expect(nav().overlay).toBe('none');
    expect(nav().sidebarOpen).toBe(true);

    expect(nav().back()).toBe(true); // closes the sidebar
    expect(nav().sidebarOpen).toBe(false);

    expect(nav().back()).toBe(true); // pops to home
    expect(currentScreen(nav())).toEqual({ name: 'empty' });
    expect(nav().back()).toBe(false); // nothing left — minimize app
  });

  it('push closes the sidebar (tapping a file navigates and dismisses)', () => {
    nav().openSidebar('files');
    nav().push({ name: 'note', path: 'a.md' });
    expect(nav().sidebarOpen).toBe(false);
  });

  it('artifact screens live in history and label tabs without the extension', () => {
    nav().push({ name: 'artifact', path: 'Artifacts/Sync Pulse.html' });
    expect(currentScreen(nav())).toEqual({ name: 'artifact', path: 'Artifacts/Sync Pulse.html' });
    expect(tabLabel(nav().tabs[0])).toBe('Sync Pulse');

    nav().renamePath('Artifacts/Sync Pulse.html', 'Artifacts/Pulse.html');
    expect(currentScreen(nav())).toEqual({ name: 'artifact', path: 'Artifacts/Pulse.html' });
  });

  it('tabs are independent and closable', () => {
    nav().push({ name: 'note', path: 'a.md' });
    nav().newTab({ name: 'note', path: 'b.md' });
    expect(nav().tabs).toHaveLength(2);
    expect(currentScreen(nav())).toEqual({ name: 'note', path: 'b.md' });
    expect(tabLabel(nav().tabs[1])).toBe('b');

    nav().closeTab(1);
    expect(nav().tabs).toHaveLength(1);
    expect(currentScreen(nav())).toEqual({ name: 'note', path: 'a.md' });

    nav().closeTab(0); // closing the last tab leaves a fresh home tab
    expect(currentScreen(nav())).toEqual({ name: 'empty' });
  });
});

describe('nav viewMode (sticky editing)', () => {
  beforeEach(() => {
    nav().reset();
    nav().setViewMode('reading');
  });
  // viewMode is a global pref that survives reset(), so restore it for others.
  afterEach(() => nav().setViewMode('reading'));

  it('defaults to reading: opening a note pushes the reader', () => {
    openNote('a.md');
    expect(currentScreen(nav())).toEqual({ name: 'note', path: 'a.md' });
  });

  it('editing mode reroutes every note open to the editor', () => {
    nav().setViewMode('editing');
    nav().push({ name: 'note', path: 'a.md' }); // e.g. from the sidebar
    expect(currentScreen(nav())).toEqual({ name: 'edit', path: 'a.md' });
    openNote('b.md'); // e.g. from quick open / a wikilink
    expect(currentScreen(nav())).toEqual({ name: 'edit', path: 'b.md' });
  });

  it('preserves the heading anchor when rerouting to the editor ([[Note#Section]])', () => {
    nav().setViewMode('editing');
    // A [[Note#Section]] tap opens {name:'note', heading} — the reroute to the
    // editor must carry the heading through so the caret can land on it.
    openNote('a.md', 'Section Two');
    expect(currentScreen(nav())).toEqual({
      name: 'edit',
      path: 'a.md',
      heading: 'Section Two',
    });
  });

  it('explicit edit pushes stay edit regardless of mode (fresh-note flows)', () => {
    nav().setViewMode('reading');
    nav().push({ name: 'edit', path: 'new.md' });
    expect(currentScreen(nav())).toEqual({ name: 'edit', path: 'new.md' });
  });

  it('flipping back to reading opens the reader again', () => {
    nav().setViewMode('editing');
    nav().push({ name: 'note', path: 'a.md' });
    expect(currentScreen(nav())).toEqual({ name: 'edit', path: 'a.md' });

    nav().setViewMode('reading');
    nav().push({ name: 'note', path: 'b.md' });
    expect(currentScreen(nav())).toEqual({ name: 'note', path: 'b.md' });
  });

  it('non-note screens are never rewritten by editing mode', () => {
    nav().setViewMode('editing');
    nav().push({ name: 'settings' });
    expect(currentScreen(nav())).toEqual({ name: 'settings' });
  });
});

describe('nav renamePath', () => {
  beforeEach(() => nav().reset());

  it('rewrites entries behind AND ahead of the current index in the active tab', () => {
    nav().push({ name: 'note', path: 'Old.md' }); // index 1
    nav().push({ name: 'edit', path: 'Old.md' }); // index 2 (current)
    nav().push({ name: 'note', path: 'Other.md' }); // index 3
    nav().back(); // back to index 2 — leaves index 3 ahead

    nav().renamePath('Old.md', 'New.md');

    const tab = nav().tabs[0];
    expect(tab.history[1]).toEqual({ name: 'note', path: 'New.md' }); // behind
    expect(tab.history[2]).toEqual({ name: 'edit', path: 'New.md' }); // current
    expect(tab.history[3]).toEqual({ name: 'note', path: 'Other.md' }); // untouched
    expect(tab.index).toBe(2);
    expect(tabLabel(tab)).toBe('New');
  });

  it('rewrites matching entries across every tab, preserving other fields', () => {
    nav().push({ name: 'note', path: 'Old.md', heading: 'Intro' });
    nav().newTab({ name: 'edit', path: 'Old.md' });
    nav().newTab({ name: 'note', path: 'Keep.md' });

    nav().renamePath('Old.md', 'Renamed.md');

    expect(nav().tabs[0].history[1]).toEqual({
      name: 'note',
      path: 'Renamed.md',
      heading: 'Intro',
    });
    expect(nav().tabs[1].history[1]).toEqual({ name: 'edit', path: 'Renamed.md' });
    expect(nav().tabs[2].history[1]).toEqual({ name: 'note', path: 'Keep.md' });
    expect(tabLabel(nav().tabs[1])).toBe('Renamed');
  });

  it('also follows path-carrying history/noteVersion screens', () => {
    nav().push({ name: 'history', path: 'Old.md' });
    nav().push({ name: 'noteVersion', path: 'Old.md', oid: 'abc', when: 1 });
    nav().renamePath('Old.md', 'New.md');
    expect(nav().tabs[0].history[1]).toEqual({ name: 'history', path: 'New.md' });
    expect(nav().tabs[0].history[2]).toEqual({
      name: 'noteVersion',
      path: 'New.md',
      oid: 'abc',
      when: 1,
    });
  });
});

describe('nav reset', () => {
  it('clears searchSeed so a previous vault query does not leak after a vault switch', () => {
    nav().seedSearch('#projects');
    expect(nav().searchSeed).toBe('#projects');
    nav().reset();
    expect(nav().searchSeed).toBeNull();
  });
});

describe('split pane', () => {
  beforeEach(() => nav().reset());

  it('openToTheRight creates a focused one-entry pane; closeSplit clears it', () => {
    nav().push({ name: 'note', path: 'main.md' });
    nav().openToTheRight('a.md');

    expect(nav().focusedPane).toBe('split');
    expect(nav().split).toEqual({ history: [{ name: 'note', path: 'a.md' }], index: 0 });
    expect(focusedScreen(nav())).toEqual({ name: 'note', path: 'a.md' });
    // The main pane is untouched underneath.
    expect(currentScreen(nav())).toEqual({ name: 'note', path: 'main.md' });

    nav().closeSplit();
    expect(nav().split).toBeNull();
    expect(nav().focusedPane).toBe('main');
    expect(focusedScreen(nav())).toEqual({ name: 'note', path: 'main.md' });
  });

  it('openToTheRight honors the global editing view mode', () => {
    nav().setViewMode('editing');
    nav().openToTheRight('a.md');
    expect(focusedScreen(nav())).toEqual({ name: 'edit', path: 'a.md' });
    nav().setViewMode('reading');
  });

  it('push and replace land in the focused pane', () => {
    nav().push({ name: 'note', path: 'main.md' });
    nav().openToTheRight('a.md');

    nav().push({ name: 'note', path: 'b.md' }); // split is focused
    expect(nav().split?.history).toHaveLength(2);
    expect(focusedScreen(nav())).toEqual({ name: 'note', path: 'b.md' });
    expect(currentScreen(nav())).toEqual({ name: 'note', path: 'main.md' });

    nav().replace({ name: 'edit', path: 'b.md' }); // view toggle in the split
    expect(focusedScreen(nav())).toEqual({ name: 'edit', path: 'b.md' });
    expect(nav().split?.history).toHaveLength(2);

    nav().setFocusedPane('main');
    nav().push({ name: 'note', path: 'c.md' }); // main is focused again
    expect(currentScreen(nav())).toEqual({ name: 'note', path: 'c.md' });
    expect(focusedScreen(nav())).toEqual({ name: 'note', path: 'c.md' });
    expect(nav().split?.history[1]).toEqual({ name: 'edit', path: 'b.md' }); // untouched
  });

  it('back/forward are pane-scoped, with pane-scoped arrow probes', () => {
    nav().push({ name: 'note', path: 'main1.md' });
    nav().push({ name: 'note', path: 'main2.md' });
    nav().openToTheRight('a.md');
    nav().push({ name: 'note', path: 'b.md' }); // split history: a → b

    expect(nav().canBackIn('split')).toBe(true);
    expect(nav().canBackIn('main')).toBe(true);

    expect(nav().back()).toBe(true); // split: b → a
    expect(focusedScreen(nav())).toEqual({ name: 'note', path: 'a.md' });
    expect(currentScreen(nav())).toEqual({ name: 'note', path: 'main2.md' }); // main untouched
    expect(nav().canBackIn('split')).toBe(false);
    expect(nav().canForwardIn('split')).toBe(true);
    expect(nav().back()).toBe(false); // split history exhausted — NOT main's

    expect(nav().forward()).toBe(true); // split: a → b
    expect(focusedScreen(nav())).toEqual({ name: 'note', path: 'b.md' });
    expect(nav().forward()).toBe(false);

    nav().setFocusedPane('main');
    expect(nav().back()).toBe(true); // main: main2 → main1
    expect(currentScreen(nav())).toEqual({ name: 'note', path: 'main1.md' });
    expect(focusedScreen(nav())).toEqual({ name: 'note', path: 'main1.md' });
    expect(nav().split?.index).toBe(1); // split untouched
  });

  it('renamePath rewrites split history entries too', () => {
    nav().openToTheRight('a.md');
    nav().push({ name: 'note', path: 'other.md' });
    nav().renamePath('a.md', 'b.md');
    expect(nav().split?.history[0]).toEqual({ name: 'note', path: 'b.md' });
    expect(nav().split?.history[1]).toEqual({ name: 'note', path: 'other.md' });
    nav().renamePath('missing.md', 'x.md');
    expect(nav().split?.history[0]).toEqual({ name: 'note', path: 'b.md' });
  });

  it('newTab and switchTab refocus the main pane; reset clears the split', () => {
    nav().openToTheRight('a.md');
    nav().newTab({ name: 'note', path: 'n.md' });
    expect(nav().focusedPane).toBe('main');
    expect(nav().split).not.toBeNull(); // pane stays open, focus moves

    nav().setFocusedPane('split');
    nav().switchTab(0);
    expect(nav().focusedPane).toBe('main');

    nav().reset();
    expect(nav().split).toBeNull();
    expect(nav().focusedPane).toBe('main');
  });
});

describe('pinned tabs', () => {
  beforeEach(() => nav().reset());

  it('push from a pinned tab opens a new tab beside it instead of navigating', () => {
    nav().push({ name: 'note', path: 'a.md' });
    nav().togglePin(0);
    nav().push({ name: 'note', path: 'b.md' });

    expect(nav().tabs).toHaveLength(2);
    expect(nav().active).toBe(1);
    expect(currentScreen(nav())).toEqual({ name: 'note', path: 'b.md' });
    // The pinned tab still shows a.md, and the new tab is not pinned.
    expect(nav().tabs[0].history[nav().tabs[0].index]).toEqual({ name: 'note', path: 'a.md' });
    expect(nav().tabs[1].pinned).toBeUndefined();
  });

  it('the new tab is inserted directly after the pinned tab, not at the end', () => {
    nav().push({ name: 'note', path: 'a.md' });
    nav().newTab({ name: 'note', path: 'z.md' });
    nav().switchTab(0);
    nav().togglePin(0);
    nav().push({ name: 'note', path: 'b.md' });
    expect(nav().tabs).toHaveLength(3);
    expect(nav().active).toBe(1);
    expect(tabLabel(nav().tabs[1])).toBe('b');
    expect(tabLabel(nav().tabs[2])).toBe('z');
  });

  it('same-file pushes (heading jumps, reader/editor reroutes) stay in the pinned tab', () => {
    nav().push({ name: 'note', path: 'a.md' });
    nav().togglePin(0);
    nav().push({ name: 'note', path: 'a.md', heading: 'h2' });
    expect(nav().tabs).toHaveLength(1);
    expect(currentScreen(nav())).toEqual({ name: 'note', path: 'a.md', heading: 'h2' });
    expect(nav().tabs[0].pinned).toBe(true);
  });

  it('a pinned tab refuses to close and blocks back/forward', () => {
    nav().push({ name: 'note', path: 'a.md' });
    nav().push({ name: 'note', path: 'a.md', heading: 'h2' });
    nav().togglePin(0);

    expect(nav().canBack()).toBe(false);
    expect(nav().back()).toBe(false);
    nav().closeTab(0);
    expect(nav().tabs).toHaveLength(1);
    expect(nav().tabs[0].pinned).toBe(true);

    nav().togglePin(0);
    expect(nav().canBack()).toBe(true);
    expect(nav().back()).toBe(true);
    expect(nav().canForward()).toBe(true);
  });
});
