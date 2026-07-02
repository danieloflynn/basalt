import { create } from 'zustand';

export type Screen =
  | { name: 'browser'; folder: string }
  | { name: 'note'; path: string }
  | { name: 'edit'; path: string }
  | { name: 'search'; initialQuery?: string }
  | { name: 'settings' }
  | { name: 'history'; path?: string };

interface NavState {
  stack: Screen[];
  push: (screen: Screen) => void;
  replace: (screen: Screen) => void;
  back: () => boolean;
  reset: () => void;
}

export const useNav = create<NavState>((set, get) => ({
  stack: [{ name: 'browser', folder: '' }],

  push: (screen) => set((s) => ({ stack: [...s.stack, screen] })),

  replace: (screen) => set((s) => ({ stack: [...s.stack.slice(0, -1), screen] })),

  back: () => {
    const { stack } = get();
    if (stack.length <= 1) return false;
    set({ stack: stack.slice(0, -1) });
    return true;
  },

  reset: () => set({ stack: [{ name: 'browser', folder: '' }] }),
}));

export function currentScreen(stack: Screen[]): Screen {
  return stack[stack.length - 1];
}

/** Open a note, replacing the top entry when it is already a reader (wikilink hops don't balloon the stack depth-first). */
export function openNote(path: string): void {
  useNav.getState().push({ name: 'note', path });
}
