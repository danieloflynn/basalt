import { useEffect } from 'react';
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
  '.sheet, .dialog, .quickopen, .vault-menu, .vault-add-overlay, canvas, input, textarea, .scrim:not(.scrim--sidebar)';

const SETTLE_MS = 180;

/**
 * Obsidian-style drawer swipes: drag right anywhere in the workspace to pull
 * the sidebar out under your finger, drag/fling left to put it away. Renders
 * nothing — it drives `.sidebar` / `.scrim--sidebar` transforms directly and
 * commits the result to nav state on release.
 */
export function DrawerGestures() {
  useEffect(() => {
    let tracking = false; // finger down, gesture not yet decided
    let active = false; // horizontal claim won — we own this gesture
    let startOpen = false;
    let startX = 0;
    let startY = 0;
    let width = 320;
    let samples: Sample[] = [];
    let raf = 0;
    let lastX = 0;

    const els = () => ({
      sidebar: document.querySelector<HTMLElement>('.sidebar'),
      scrim: document.querySelector<HTMLElement>('.scrim--sidebar'),
    });

    const render = () => {
      raf = 0;
      const { sidebar, scrim } = els();
      if (!sidebar) return;
      const p = drawerProgress(startOpen, lastX - startX, width);
      sidebar.style.transform = `translateX(${(p - 1) * 100}%)`;
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

    const settle = (open: boolean) => {
      const { sidebar, scrim } = els();
      const nav = useNav.getState();
      if (!sidebar) {
        open ? nav.openSidebar() : nav.closeSidebar();
        return;
      }
      sidebar.style.transition = `transform ${SETTLE_MS}ms var(--ease)`;
      sidebar.style.transform = open ? 'translateX(0%)' : 'translateX(-102%)';
      if (scrim) {
        scrim.style.transition = `opacity ${SETTLE_MS}ms var(--ease)`;
        scrim.style.opacity = open ? '1' : '0';
      }
      window.setTimeout(() => {
        // Commit state first, then drop inline styles — same visual position.
        open ? nav.openSidebar() : nav.closeSidebar();
        for (const el of [sidebar, scrim]) {
          if (!el) continue;
          el.style.transition = '';
          el.style.transform = '';
          el.style.opacity = '';
          el.style.visibility = '';
          el.style.pointerEvents = '';
        }
      }, SETTLE_MS);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const nav = useNav.getState();
      if (nav.overlay !== 'none') return;
      const t = e.touches[0];
      if ((e.target as Element | null)?.closest?.(IGNORE)) return;

      startOpen = nav.sidebarOpen;
      startX = t.clientX;
      startY = t.clientY;
      lastX = t.clientX;
      samples = [{ t: e.timeStamp, x: t.clientX, y: t.clientY }];
      tracking = true;
      active = false;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!active) {
        const axis = claimAxis(dx, dy);
        if (axis === 'y') {
          tracking = false;
          return;
        }
        if (axis !== 'x') return;
        // Direction must make sense: right opens, left closes.
        if (!startOpen && dx <= 0) return void (tracking = false);
        if (startOpen && dx >= 0) return void (tracking = false);
        if (!startOpen && scrollsHorizontally(e.target)) return void (tracking = false);

        active = true;
        const { sidebar } = els();
        width = sidebar?.getBoundingClientRect().width || window.innerWidth - 52;
        document.documentElement.setAttribute('data-drawer-drag', '');
      }

      e.preventDefault();
      lastX = t.clientX;
      samples.push({ t: e.timeStamp, x: t.clientX, y: t.clientY });
      if (samples.length > 24) samples.splice(0, samples.length - 24);
      if (!raf) raf = requestAnimationFrame(render);
    };

    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!active) return;
      active = false;
      document.documentElement.removeAttribute('data-drawer-drag');
      const p = drawerProgress(startOpen, lastX - startX, width);
      settle(settleOpen(p, velocityX(samples)));
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
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
