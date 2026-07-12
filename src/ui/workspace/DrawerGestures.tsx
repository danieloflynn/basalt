import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import {
  claimAxis,
  drawerProgress,
  settleOpen,
  velocityX,
  type Sample,
} from '@/lib/gesture';
import { useNav } from '@/state/nav';

/** Touches inside these never move the drawer. */
const IGNORE =
  '.sheet, .dialog, .quickopen, .vault-menu, .vault-add-overlay, canvas, input, textarea, .scrim:not(.scrim--sidebar):not(.scrim--rightbar)';

/**
 * Everything that differs between the left drawer and a (planned) right one.
 * The math in gesture.ts is written for a left drawer — positive finger travel
 * opens it — so `dir` re-signs travel/velocity for a mirrored panel and
 * `toTransform` maps progress (0 closed … 1 open) to the inline transform.
 */
interface DrawerSide {
  sidebar: string;
  scrim: string;
  /** +1: opens by dragging toward +x (left drawer). -1: mirrored right drawer. */
  dir: 1 | -1;
  toTransform: (progress: number) => string;
  isOpen: () => boolean;
  /**
   * Whether the OPPOSITE drawer is open. A swipe while it is showing belongs
   * to its controller (closing it) — e.g. a left-swipe with the left drawer
   * open closes the left drawer, it must never open this one.
   */
  otherOpen: () => boolean;
  commit: (open: boolean) => void;
}

const LEFT: DrawerSide = {
  sidebar: '.sidebar',
  scrim: '.scrim--sidebar',
  dir: 1,
  toTransform: (p) => `translateX(${(p - 1) * 100}%)`,
  isOpen: () => useNav.getState().sidebarOpen,
  otherOpen: () => useNav.getState().rightSidebarOpen,
  commit: (open) => (open ? useNav.getState().openSidebar() : useNav.getState().closeSidebar()),
};

/** Mirrored right drawer (backlinks): swipe left opens, swipe right closes. */
const RIGHT: DrawerSide = {
  sidebar: '.sidebar-right',
  scrim: '.scrim--rightbar',
  dir: -1,
  toTransform: (p) => `translateX(${(1 - p) * 100}%)`,
  isOpen: () => useNav.getState().rightSidebarOpen,
  otherOpen: () => useNav.getState().sidebarOpen,
  commit: (open) =>
    open ? useNav.getState().openRightSidebar() : useNav.getState().closeRightSidebar(),
};

/**
 * Installs document-level touch listeners driving one edge drawer. Renders
 * nothing — it scrubs the panel/scrim transforms inline while a finger drags
 * and commits the result to nav state on release.
 *
 * State machine invariant: every gesture that claims the drawer ends in exactly
 * one of {fully open, fully closed}. `settle()` is synchronous (it commits nav
 * via flushSync, so `data-open` is on the DOM before the inline transform is
 * dropped) and leaves no pending timer, so no stale callback can fire into a
 * later gesture and strand the drawer half-open. Any queued rAF is cancelled
 * before we settle, and `render()` is a no-op once the gesture is no longer
 * active, so a straggler frame can't re-apply a stale transform on top.
 */
function installDrawer(side: DrawerSide): () => void {
  let tracking = false; // finger down, gesture not yet decided
  let active = false; // horizontal claim won — we own this gesture
  let pointerId = -1; // the one finger we follow (ignore the rest)
  let startOpen = false;
  let startX = 0;
  let startY = 0;
  let width = 320;
  let samples: Sample[] = [];
  let raf = 0;
  let lastX = 0;

  const els = () => ({
    sidebar: document.querySelector<HTMLElement>(side.sidebar),
    scrim: document.querySelector<HTMLElement>(side.scrim),
  });

  const cancelRaf = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const render = () => {
    raf = 0;
    if (!active) return; // gesture already ended — don't re-pin a stale frame
    const { sidebar, scrim } = els();
    if (!sidebar) return;
    const p = drawerProgress(startOpen, side.dir * (lastX - startX), width);
    sidebar.style.transform = side.toTransform(p);
    sidebar.style.visibility = 'visible';
    if (scrim) {
      scrim.style.opacity = String(p);
      scrim.style.pointerEvents = p > 0 ? 'auto' : 'none';
    }
  };

  /** Let horizontally scrollable content (tables, code) win over the drawer. */
  const scrollsHorizontally = (from: EventTarget | null): boolean => {
    let el = from instanceof Element ? from : null;
    while (el && !el.classList.contains('shell')) {
      if (el.scrollWidth > el.clientWidth + 4) {
        const overflow = getComputedStyle(el).overflowX;
        if (overflow === 'auto' || overflow === 'scroll') return true;
      }
      el = el.parentElement;
    }
    return false;
  };

  const clearInline = (el: HTMLElement | null) => {
    if (!el) return;
    el.style.transition = '';
    el.style.transform = '';
    el.style.opacity = '';
    el.style.visibility = '';
    el.style.pointerEvents = '';
  };

  /**
   * Commit the drawer to `open` and hand the animation back to CSS. Fully
   * synchronous: re-enable transitions, commit nav (flushSync so `data-open`
   * lands before we drop the inline transform — otherwise the open path would
   * flash to the CSS-closed position), then clear the inline styles so the
   * `.sidebar` / `.scrim` transition carries it the rest of the way. No timer,
   * so nothing can fire into a subsequent gesture.
   */
  const settle = (open: boolean) => {
    cancelRaf();
    const { sidebar, scrim } = els();
    document.documentElement.removeAttribute('data-drawer-drag');
    flushSync(() => side.commit(open));
    clearInline(sidebar);
    clearInline(scrim);
  };

  const onStart = (e: TouchEvent) => {
    // A second finger while we're already dragging must not restart tracking.
    if (tracking || active) return;
    if (e.touches.length !== 1) return;
    if (useNav.getState().overlay !== 'none') return;
    // Route to the visible drawer: while the opposite one is open, every
    // horizontal swipe is its close gesture, never our open gesture.
    if (side.otherOpen()) return;
    const t = e.touches[0];
    if ((e.target as Element | null)?.closest?.(IGNORE)) return;

    startOpen = side.isOpen();
    startX = t.clientX;
    startY = t.clientY;
    lastX = t.clientX;
    pointerId = t.identifier;
    samples = [{ t: e.timeStamp, x: t.clientX, y: t.clientY }];
    tracking = true;
    active = false;
  };

  const onMove = (e: TouchEvent) => {
    if (!tracking) return;
    // Follow only the finger that started the gesture, so a second finger
    // landing mid-drag can't corrupt dx.
    const t = Array.prototype.find.call(e.touches, (x: Touch) => x.identifier === pointerId) as
      | Touch
      | undefined;
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (!active) {
      // A long-pressed note being dragged in the file tree owns the touch.
      if (document.documentElement.hasAttribute('data-tree-drag')) {
        tracking = false;
        return;
      }
      const axis = claimAxis(dx, dy);
      if (axis === 'y') {
        tracking = false;
        return;
      }
      if (axis !== 'x') return;
      // Direction must make sense: opening pulls the panel out, closing pushes
      // it away. `odx` is travel re-signed so +ve always means "toward open".
      const odx = side.dir * dx;
      if (!startOpen && odx <= 0) return void (tracking = false);
      if (startOpen && odx >= 0) return void (tracking = false);
      if (!startOpen && scrollsHorizontally(e.target)) return void (tracking = false);

      active = true;
      const { sidebar } = els();
      // Full-width drawers: fall back to the whole viewport if the panel hasn't
      // been measured yet. Normally the measured element width is authoritative.
      width = sidebar?.getBoundingClientRect().width || window.innerWidth;
      document.documentElement.setAttribute('data-drawer-drag', '');
    }

    e.preventDefault();
    lastX = t.clientX;
    samples.push({ t: e.timeStamp, x: t.clientX, y: t.clientY });
    if (samples.length > 24) samples.splice(0, samples.length - 24);
    if (!raf) raf = requestAnimationFrame(render);
  };

  const onEnd = (e: TouchEvent) => {
    if (!tracking) return;
    // Only our finger ending (or the whole gesture being cancelled) counts.
    const mine =
      !e.changedTouches?.length ||
      Array.prototype.some.call(e.changedTouches, (x: Touch) => x.identifier === pointerId);
    if (!mine) return;
    tracking = false;
    const wasActive = active;
    active = false;
    if (!wasActive) {
      cancelRaf();
      return; // never claimed — nothing was applied, nothing to settle
    }
    const p = drawerProgress(startOpen, side.dir * (lastX - startX), width);
    // Pass the release timestamp so a fast drag that then holds still before
    // lifting settles by position, not by the stale trailing flick velocity.
    settle(settleOpen(p, side.dir * velocityX(samples, e.timeStamp)));
  };

  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd, { passive: true });
  document.addEventListener('touchcancel', onEnd, { passive: true });
  return () => {
    document.removeEventListener('touchstart', onStart);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('touchcancel', onEnd);
    cancelRaf();
  };
}

/**
 * Obsidian-style drawer swipes: drag right anywhere in the workspace to pull
 * the sidebar out under your finger, drag left for the backlinks drawer, and
 * drag/fling back to put either away. Renders nothing — {@link installDrawer}
 * drives the panel/scrim transforms directly and commits the result to nav
 * state on release. `otherOpen` keeps the two controllers exclusive, so a
 * left-swipe with the left drawer open closes it instead of opening the right.
 */
export function DrawerGestures() {
  useEffect(() => {
    const offLeft = installDrawer(LEFT);
    const offRight = installDrawer(RIGHT);
    return () => {
      offLeft();
      offRight();
    };
  }, []);
  return null;
}
