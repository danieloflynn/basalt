import { useEffect, useRef } from 'react';
import { pullTriggered } from '@/lib/gesture';

/**
 * Obsidian's pull-down-to-search: a firm downward drag while the scroller is
 * already at the top fires `onPull` once (we open Quick Open). Normal scrolls
 * never trigger it because the scroller isn't at rest at the top.
 */
export function usePullDown<T extends HTMLElement>(onPull: () => void) {
  const ref = useRef<T | null>(null);
  const cb = useRef(onPull);
  cb.current = onPull;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let eligible = false;
    let fired = false;

    const onStart = (e: TouchEvent) => {
      eligible = el.scrollTop <= 0 && e.touches.length === 1;
      fired = false;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (!eligible || fired || el.scrollTop > 0) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (dy < 0) {
        eligible = false; // it's a scroll up, not a pull
        return;
      }
      if (pullTriggered(dx, dy)) {
        fired = true;
        cb.current();
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
    };
  }, []);

  return ref;
}
