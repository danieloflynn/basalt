import { create } from 'zustand';

/**
 * Desktop pane sizes — the widths of the docked sidebars and the main/split
 * ratio, draggable via the PaneResizers handles. Per-device UI state, so it
 * persists to localStorage rather than the (synced) vault settings. Mobile
 * never reads any of this: the drawers there are fixed-width overlays.
 */

export const PANE_DEFAULTS = {
  sidebarW: 260,
  rightbarW: 300,
  /** Main pane's share of the workspace when a split is open (0..1). */
  splitRatio: 0.5,
};

/** Hard bounds so a drag can never wedge a panel unusably small or wide. */
export const PANE_LIMITS = {
  sidebarW: { min: 180, max: 480 },
  rightbarW: { min: 200, max: 520 },
  splitRatio: { min: 0.25, max: 0.75 },
};

const STORAGE_KEY = 'basalt.paneSizes.v1';

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

interface PaneSizesState {
  sidebarW: number;
  rightbarW: number;
  splitRatio: number;
  setSidebarW: (px: number) => void;
  setRightbarW: (px: number) => void;
  setSplitRatio: (ratio: number) => void;
  reset: (which: 'sidebarW' | 'rightbarW' | 'splitRatio') => void;
}

function load(): Pick<PaneSizesState, 'sidebarW' | 'rightbarW' | 'splitRatio'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...PANE_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<typeof PANE_DEFAULTS>;
    return {
      sidebarW: clamp(
        typeof parsed.sidebarW === 'number' ? parsed.sidebarW : PANE_DEFAULTS.sidebarW,
        PANE_LIMITS.sidebarW.min,
        PANE_LIMITS.sidebarW.max,
      ),
      rightbarW: clamp(
        typeof parsed.rightbarW === 'number' ? parsed.rightbarW : PANE_DEFAULTS.rightbarW,
        PANE_LIMITS.rightbarW.min,
        PANE_LIMITS.rightbarW.max,
      ),
      splitRatio: clamp(
        typeof parsed.splitRatio === 'number' ? parsed.splitRatio : PANE_DEFAULTS.splitRatio,
        PANE_LIMITS.splitRatio.min,
        PANE_LIMITS.splitRatio.max,
      ),
    };
  } catch {
    return { ...PANE_DEFAULTS };
  }
}

function save(s: Pick<PaneSizesState, 'sidebarW' | 'rightbarW' | 'splitRatio'>): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sidebarW: s.sidebarW, rightbarW: s.rightbarW, splitRatio: s.splitRatio }),
    );
  } catch {
    // Private mode / quota: sizes simply don't persist.
  }
}

export const usePaneSizes = create<PaneSizesState>()((set, get) => {
  const update = (patch: Partial<PaneSizesState>) => {
    set(patch);
    const { sidebarW, rightbarW, splitRatio } = get();
    save({ sidebarW, rightbarW, splitRatio });
  };
  return {
    ...load(),
    setSidebarW: (px) =>
      update({ sidebarW: clamp(Math.round(px), PANE_LIMITS.sidebarW.min, PANE_LIMITS.sidebarW.max) }),
    setRightbarW: (px) =>
      update({
        rightbarW: clamp(Math.round(px), PANE_LIMITS.rightbarW.min, PANE_LIMITS.rightbarW.max),
      }),
    setSplitRatio: (ratio) =>
      update({ splitRatio: clamp(ratio, PANE_LIMITS.splitRatio.min, PANE_LIMITS.splitRatio.max) }),
    reset: (which) => update({ [which]: PANE_DEFAULTS[which] }),
  };
});
