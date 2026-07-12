import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { create } from 'zustand';
import { parseFrontmatter } from '@/lib/frontmatter';
import { noteTitle } from '@/lib/paths';
import { vaultService } from '@/services';
import { useNav } from '@/state/nav';
import { extractSection, Markdown } from '@/ui/markdown/Markdown';

/**
 * Obsidian's Page Preview: hold ⌘/Ctrl and hover a link in the reading view
 * to float a rendered preview of the target note. Desktop-only — the show
 * trigger no-ops on phones, so the mobile DOM never changes.
 *
 * SmartAnchor calls maybeShowHoverPreview from its mousemove (mousemove, not
 * mouseenter, so pressing the modifier after the pointer is already on the
 * link still works) and cancelHoverPreview on mouseleave. The card itself
 * keeps the preview alive while hovered, so it can be scrolled.
 */

interface PreviewTarget {
  path: string;
  heading?: string;
  /** Anchor rect corner the card hangs from (viewport coordinates). */
  left: number;
  top: number;
  bottom: number;
}

interface HoverPreviewState {
  target: PreviewTarget | null;
  show: (t: PreviewTarget) => void;
  hide: () => void;
}

export const useHoverPreview = create<HoverPreviewState>((set) => ({
  target: null,
  show: (target) => set({ target }),
  hide: () => set({ target: null }),
}));

const SHOW_DELAY_MS = 250;
/** Grace period to move the pointer from the link into the card. */
const HIDE_DELAY_MS = 120;

let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let pendingEl: HTMLElement | null = null;

export function maybeShowHoverPreview(
  e: ReactMouseEvent<HTMLElement>,
  path: string,
  heading?: string,
): void {
  if (!useNav.getState().desktop) return;
  if (!(e.metaKey || e.ctrlKey)) return;
  clearTimeout(hideTimer);
  const el = e.currentTarget;
  const cur = useHoverPreview.getState().target;
  if (pendingEl === el || (cur && cur.path === path && cur.heading === heading)) return;
  clearTimeout(showTimer);
  pendingEl = el;
  const rect = el.getBoundingClientRect();
  showTimer = setTimeout(() => {
    pendingEl = null;
    useHoverPreview
      .getState()
      .show({ path, heading, left: rect.left, top: rect.top, bottom: rect.bottom });
  }, SHOW_DELAY_MS);
}

export function cancelHoverPreview(): void {
  pendingEl = null;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (useHoverPreview.getState().target) {
    hideTimer = setTimeout(() => useHoverPreview.getState().hide(), HIDE_DELAY_MS);
  }
}

/** Mounted once in App; renders nothing until a preview is triggered. */
export function HoverPreviewCard() {
  const target = useHoverPreview((s) => s.target);
  if (!target) return null;
  // Keyed so switching links remounts the card (fresh content + position).
  return <PreviewPopover key={`${target.path}#${target.heading ?? ''}`} target={target} />;
}

function PreviewPopover({ target }: { target: PreviewTarget }) {
  const hide = useHoverPreview((s) => s.hide);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // vaultService.noteContent is the synchronous in-memory cache (same one the
  // backlinks panel reads), so the body is available at first render.
  const raw = vaultService.noteContent(target.path) ?? '';
  const body = parseFrontmatter(raw).body;
  const section = target.heading ? extractSection(body, target.heading) : body;

  // Hang the card below the link, clamped to the viewport; flip above when
  // there's more room there. First paint is invisible so the real size can
  // be measured (same trick as useAnchoredMenu).
  useLayoutEffect(() => {
    const margin = 8;
    const gap = 6;
    const el = ref.current;
    const w = el?.offsetWidth ?? 360;
    const h = el?.offsetHeight ?? 240;
    let left = Math.min(target.left, window.innerWidth - w - margin);
    left = Math.max(left, margin);
    const below = target.bottom + gap;
    const fitsBelow = below + h + margin <= window.innerHeight;
    const top = fitsBelow ? below : Math.max(margin, target.top - gap - h);
    setPos({ left, top });
  }, [target]);

  // Close on click-away, Escape, or scroll OUTSIDE the card — scrolling the
  // preview itself must not dismiss it (that's the point of the grace hover).
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) hide();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      hide();
    };
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
  }, [hide]);

  return (
    <div
      ref={ref}
      className="hover-preview"
      role="tooltip"
      aria-label={`Preview of ${noteTitle(target.path)}`}
      style={
        pos
          ? { left: pos.left, top: pos.top, visibility: 'visible' }
          : { left: target.left, top: target.bottom, visibility: 'hidden' }
      }
      onMouseEnter={() => clearTimeout(hideTimer)}
      onMouseLeave={() => hide()}
    >
      <div className="hover-preview__title">{noteTitle(target.path)}</div>
      <Markdown source={section} path={target.path} depth={1} />
    </div>
  );
}
