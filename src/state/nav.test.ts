import { beforeEach, describe, expect, it } from 'vitest';
import { currentScreen, tabLabel, useNav } from './nav';

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
