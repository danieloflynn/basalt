import { create } from 'zustand';

export type Screen =
  | { name: 'empty' }
  | { name: 'note'; path: string; heading?: string }
  | { name: 'edit'; path: string }
  | { name: 'artifact'; path: string }
  | { name: 'settings' }
  | { name: 'history'; path?: string }
  | { name: 'noteVersion'; path: string; oid: string; when: number }
  | { name: 'graph'; path?: string };

export type SidebarView = 'files' | 'search' | 'tags' | 'properties' | 'bookmarks';

/** Global default view (Obsidian's "default editing/reading" toggle). */
export type ViewMode = 'reading' | 'editing';

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

  /**
   * Sticky view mode: when 'editing', every note opened via `push` lands in the
   * editor instead of the reader (Obsidian's universal default-view toggle).
   * Held here (nav is self-contained) so `push` can consult it without importing
   * the settings store; App bootstrap hydrates it from persisted settings and
   * the eye/pencil toggles mirror it back.
   */
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  push: (screen: Screen) => void;
  replace: (screen: Screen) => void;
  /** After a file rename: repoint every history entry (all tabs) at the old path. */
  renamePath: (from: string, to: string) => void;
  back: () => boolean;
  forward: () => boolean;
  canBack: () => boolean;
  canForward: () => boolean;
  reset: () => void;

  openSidebar: (view?: SidebarView) => void;
  closeSidebar: () => void;
  /** Right drawer (backlinks) — mutually exclusive with the left sidebar. */
  rightSidebarOpen: boolean;
  openRightSidebar: () => void;
  closeRightSidebar: () => void;
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

  viewMode: 'reading',
  setViewMode: (mode) => set({ viewMode: mode }),

  push: (screen) =>
    set((s) => {
      // Editing mode reroutes reader opens to the editor; explicit 'edit' pushes
      // (new-note flows) are untouched, so fresh notes always open to write.
      const eff: Screen =
        s.viewMode === 'editing' && screen.name === 'note'
          ? { name: 'edit', path: screen.path }
          : screen;
      return {
        sidebarOpen: false,
        rightSidebarOpen: false,
        tabs: s.tabs.map((tab, i) => {
          if (i !== s.active) return tab;
          const history = [...tab.history.slice(0, tab.index + 1), eff];
          return { history, index: history.length - 1 };
        }),
      };
    }),

  replace: (screen) =>
    set((s) => ({
      tabs: s.tabs.map((tab, i) => {
        if (i !== s.active) return tab;
        const history = [...tab.history];
        history[tab.index] = screen;
        return { ...tab, history };
      }),
    })),

  renamePath: (from, to) =>
    set((s) => ({
      // Keeps back/forward stacks, other tabs, and tabLabel (derived from path)
      // correct after a rename — every screen carrying the old path is rewritten.
      tabs: s.tabs.map((tab) => {
        let changed = false;
        const history = tab.history.map((screen) => {
          if ('path' in screen && screen.path === from) {
            changed = true;
            return { ...screen, path: to };
          }
          return screen;
        });
        return changed ? { ...tab, history } : tab;
      }),
    })),

  back: () => {
    const { tabs, active, sidebarOpen, rightSidebarOpen, overlay } = get();
    if (overlay !== 'none') {
      set({ overlay: 'none' });
      return true;
    }
    if (rightSidebarOpen) {
      set({ rightSidebarOpen: false });
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
    set({
      tabs: [newTabState()],
      active: 0,
      sidebarOpen: false,
      rightSidebarOpen: false,
      sidebarView: 'files',
      overlay: 'none',
    }),

  openSidebar: (view) =>
    set((s) => ({ sidebarOpen: true, rightSidebarOpen: false, sidebarView: view ?? s.sidebarView })),
  closeSidebar: () => set({ sidebarOpen: false }),
  rightSidebarOpen: false,
  openRightSidebar: () => set({ rightSidebarOpen: true, sidebarOpen: false }),
  closeRightSidebar: () => set({ rightSidebarOpen: false }),
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
    case 'artifact':
      return top.path.split('/').pop()?.replace(/\.(md|html?)$/i, '') ?? top.path;
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
