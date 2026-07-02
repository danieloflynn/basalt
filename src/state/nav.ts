import { create } from 'zustand';

export type Screen =
  | { name: 'empty' }
  | { name: 'note'; path: string; heading?: string }
  | { name: 'edit'; path: string }
  | { name: 'settings' }
  | { name: 'history'; path?: string }
  | { name: 'noteVersion'; path: string; oid: string; when: number }
  | { name: 'graph'; path?: string };

export type SidebarView = 'files' | 'search' | 'tags' | 'properties' | 'bookmarks';

/** Workspace overlays (bottom-pill popups); global so gestures can open them. */
export type Overlay = 'none' | 'quickopen' | 'tabs' | 'palette';

interface Tab {
  /** Visited screens; index points at the current one (enables forward). */
  history: Screen[];
  index: number;
}

const HOME: Screen = { name: 'empty' };
const newTabState = (): Tab => ({ history: [HOME], index: 0 });

interface NavState {
  tabs: Tab[];
  active: number;
  sidebarOpen: boolean;
  sidebarView: SidebarView;

  push: (screen: Screen) => void;
  replace: (screen: Screen) => void;
  back: () => boolean;
  forward: () => boolean;
  canBack: () => boolean;
  canForward: () => boolean;
  reset: () => void;

  openSidebar: (view?: SidebarView) => void;
  closeSidebar: () => void;
  setSidebarView: (view: SidebarView) => void;
  /** Prefill the sidebar search view and open it (tag taps etc.). */
  searchSeed: string | null;
  seedSearch: (query: string) => void;

  overlay: Overlay;
  setOverlay: (overlay: Overlay) => void;

  /** Editor has the keyboard: toolbar replaces the bottom pill (Obsidian). */
  editorFocused: boolean;
  setEditorFocused: (focused: boolean) => void;

  newTab: (screen?: Screen) => void;
  closeTab: (index: number) => void;
  switchTab: (index: number) => void;
}

export const useNav = create<NavState>((set, get) => ({
  tabs: [newTabState()],
  active: 0,
  sidebarOpen: false,
  sidebarView: 'files',

  push: (screen) =>
    set((s) => ({
      sidebarOpen: false,
      tabs: s.tabs.map((tab, i) => {
        if (i !== s.active) return tab;
        const history = [...tab.history.slice(0, tab.index + 1), screen];
        return { history, index: history.length - 1 };
      }),
    })),

  replace: (screen) =>
    set((s) => ({
      tabs: s.tabs.map((tab, i) => {
        if (i !== s.active) return tab;
        const history = [...tab.history];
        history[tab.index] = screen;
        return { ...tab, history };
      }),
    })),

  back: () => {
    const { tabs, active, sidebarOpen, overlay } = get();
    if (overlay !== 'none') {
      set({ overlay: 'none' });
      return true;
    }
    if (sidebarOpen) {
      set({ sidebarOpen: false });
      return true;
    }
    const tab = tabs[active];
    if (tab.index === 0) return false;
    set({
      tabs: tabs.map((t, i) => (i === active ? { ...t, index: t.index - 1 } : t)),
    });
    return true;
  },

  forward: () => {
    const { tabs, active } = get();
    const tab = tabs[active];
    if (tab.index >= tab.history.length - 1) return false;
    set({
      tabs: tabs.map((t, i) => (i === active ? { ...t, index: t.index + 1 } : t)),
    });
    return true;
  },

  canBack: () => {
    const { tabs, active } = get();
    return tabs[active].index > 0;
  },

  canForward: () => {
    const { tabs, active } = get();
    const tab = tabs[active];
    return tab.index < tab.history.length - 1;
  },

  reset: () =>
    set({ tabs: [newTabState()], active: 0, sidebarOpen: false, sidebarView: 'files', overlay: 'none' }),

  openSidebar: (view) =>
    set((s) => ({ sidebarOpen: true, sidebarView: view ?? s.sidebarView })),
  closeSidebar: () => set({ sidebarOpen: false }),
  setSidebarView: (view) => set({ sidebarView: view, searchSeed: null }),
  searchSeed: null,
  seedSearch: (query) =>
    set({ searchSeed: query, sidebarView: 'search', sidebarOpen: true }),

  overlay: 'none',
  setOverlay: (overlay) => set({ overlay }),

  editorFocused: false,
  setEditorFocused: (focused) => set({ editorFocused: focused }),

  newTab: (screen) =>
    set((s) => ({
      tabs: [
        ...s.tabs,
        screen ? { history: [HOME, screen], index: 1 } : newTabState(),
      ],
      active: s.tabs.length,
      sidebarOpen: false,
    })),

  closeTab: (index) =>
    set((s) => {
      if (s.tabs.length <= 1) return { tabs: [newTabState()], active: 0 };
      const tabs = s.tabs.filter((_, i) => i !== index);
      const active = index < s.active ? s.active - 1 : s.active;
      return { tabs, active: Math.max(0, Math.min(active, tabs.length - 1)) };
    }),

  switchTab: (index) =>
    set((s) => ({
      active: Math.max(0, Math.min(index, s.tabs.length - 1)),
      sidebarOpen: false,
    })),
}));

export function currentScreen(state: { tabs: Tab[]; active: number }): Screen {
  const tab = state.tabs[state.active];
  return tab.history[tab.index];
}

/** Title-ish description of a tab (its current screen) for the tab switcher. */
export function tabLabel(tab: Tab): string {
  const top = tab.history[tab.index];
  switch (top.name) {
    case 'empty':
      return 'New tab';
    case 'note':
    case 'edit':
    case 'noteVersion':
      return top.path.split('/').pop()?.replace(/\.md$/i, '') ?? top.path;
    case 'settings':
      return 'Settings';
    case 'history':
      return 'History';
    case 'graph':
      return 'Graph';
  }
}

export function openNote(path: string, heading?: string): void {
  useNav.getState().push({ name: 'note', path, heading });
}
