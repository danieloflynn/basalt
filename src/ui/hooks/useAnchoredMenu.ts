import { useLayoutEffect, useRef, useState } from 'react';

export interface AnchorPoint {
  x: number;
  y: number;
}

export interface UseAnchoredMenuOptions {
  /**
   * Viewport point to anchor at, or null when the menu isn't in anchored
   * (desktop context-menu) mode — the hook then does nothing, so callers can
   * call it unconditionally (rules of hooks) even while rendering the mobile
   * bottom sheet instead.
   */
  anchor: AnchorPoint | null;
  onClose: () => void;
  /**
   * 'start' (default) puts the menu's top-left corner at the anchor — right
   * where a pointer/right-click landed. 'end' puts the menu's top-RIGHT
   * corner at the anchor instead, for anchoring below-right of a trigger
   * control (e.g. a ⋮ button's bottom-right corner).
   */
  align?: 'start' | 'end';
}

interface UseAnchoredMenuResult {
  ref: React.RefObject<HTMLDivElement | null>;
  style: React.CSSProperties;
}

/**
 * Positions a fixed-position popup at a viewport anchor point, clamped so it
 * never overflows the viewport, and closes it on click-away, Escape, or
 * scroll (any scroller, via a capturing listener — `scroll` doesn't bubble).
 * Obsidian-style context-menu precedent: `.tablist-menu` in DesktopChrome.tsx
 * and `.vault-menu` in VaultMenu.tsx already do a simpler, unclamped version
 * of this; this hook generalizes the positioning math so FileActionsSheet and
 * NoteMenu can both anchor at an arbitrary point (right-click) or a trigger's
 * edge (the ⋮ button) without overflowing a small or oddly-placed window.
 *
 * First paint renders the menu invisible at the raw anchor so its real size
 * can be measured; `useLayoutEffect` then clamps and reveals it before the
 * browser paints, so there's no visible jump.
 */
export function useAnchoredMenu({
  anchor,
  onClose,
  align = 'start',
}: UseAnchoredMenuOptions): UseAnchoredMenuResult {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      setPos(null);
      return;
    }
    const margin = 8;
    const el = ref.current;
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 0;
    let left = align === 'end' ? anchor.x - w : anchor.x;
    let top = anchor.y;
    left = Math.min(left, window.innerWidth - w - margin);
    left = Math.max(left, margin);
    top = Math.min(top, window.innerHeight - h - margin);
    top = Math.max(top, margin);
    setPos({ left, top });
  }, [anchor, align]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();
    // Capture phase: `scroll` doesn't bubble, so a listener on document only
    // sees it fire during capture (top-down), regardless of which scroller
    // (or the window) actually moved.
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [anchor, onClose]);

  if (!anchor) {
    return { ref, style: {} };
  }

  return {
    ref,
    style: pos
      ? { position: 'fixed', left: pos.left, top: pos.top, visibility: 'visible' }
      : { position: 'fixed', left: anchor.x, top: anchor.y, visibility: 'hidden' },
  };
}
