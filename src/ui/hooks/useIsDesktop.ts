import { useSyncExternalStore } from 'react';

/**
 * True when the viewport is wide enough for the docked, three-pane desktop
 * layout (Basalt as a Mac app, or a wide browser window). Below this the app
 * stays in its phone form: overlay drawers, bottom pill, swipe gestures.
 *
 * 960px is the smallest width where a 260px file tree + a readable ~640px
 * column + a 300px backlinks pane all fit without crowding.
 */
export const DESKTOP_QUERY = '(min-width: 960px)';

const mql = () => window.matchMedia(DESKTOP_QUERY);

function subscribe(onChange: () => void): () => void {
  const m = mql();
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => mql().matches,
    () => false, // SSR/first paint: assume phone (the safe, simplest layout)
  );
}
