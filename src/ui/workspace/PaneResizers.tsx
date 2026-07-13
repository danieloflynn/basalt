import { useRef } from 'react';
import { useNav } from '@/state/nav';
import { usePaneSizes } from '@/state/paneSizes';

type Kind = 'left' | 'right' | 'split';

const LABELS: Record<Kind, string> = {
  left: 'Resize sidebar',
  right: 'Resize right sidebar',
  split: 'Resize split pane',
};

/**
 * Invisible drag handles on the desktop grid's pane boundaries: the file-tree
 * edge, the right sidebar edge, and the split divider. Each straddles its grid
 * line as an 8px hit strip (a 2px line lights up on hover/drag), writes the
 * dragged size to the persisted paneSizes store, and resets to the default on
 * double-click. Desktop-only: App mounts this only in docked mode, and each
 * handle renders only while its panel is open.
 */
export function PaneResizers() {
  const left = useNav((s) => s.sidebarOpen);
  const right = useNav((s) => s.rightSidebarOpen);
  const split = useNav((s) => s.split !== null);
  return (
    <>
      {left && <Handle kind="left" />}
      {right && <Handle kind="right" />}
      {split && <Handle kind="split" />}
    </>
  );
}

function Handle({ kind }: { kind: Kind }) {
  const ref = useRef<HTMLDivElement>(null);
  // Split drags move a ratio, not a px width, so the workspace width (main +
  // split panes) is measured once at drag start and the ratio derived from it.
  const drag = useRef<{ startX: number; startW: number; total: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const sizes = usePaneSizes.getState();
    let startW: number;
    let total = 0;
    if (kind === 'left') {
      startW = sizes.sidebarW;
    } else if (kind === 'right') {
      startW = sizes.rightbarW;
    } else {
      const main = document.querySelector('.shell > .screen');
      const split = document.querySelector('.shell > .split-pane');
      if (!main || !split) return;
      startW = main.getBoundingClientRect().width;
      total = startW + split.getBoundingClientRect().width;
      if (total === 0) return;
    }
    drag.current = { startX: e.clientX, startW, total };
    ref.current?.setPointerCapture(e.pointerId);
    ref.current?.setAttribute('data-dragging', '');
    document.body.classList.add('is-col-resizing');
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const sizes = usePaneSizes.getState();
    if (kind === 'left') sizes.setSidebarW(d.startW + dx);
    else if (kind === 'right') sizes.setRightbarW(d.startW - dx);
    else sizes.setSplitRatio((d.startW + dx) / d.total);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    ref.current?.releasePointerCapture(e.pointerId);
    ref.current?.removeAttribute('data-dragging');
    document.body.classList.remove('is-col-resizing');
  };

  return (
    <div
      ref={ref}
      className={`pane-resizer pane-resizer--${kind}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={LABELS[kind]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() =>
        usePaneSizes
          .getState()
          .reset(kind === 'left' ? 'sidebarW' : kind === 'right' ? 'rightbarW' : 'splitRatio')
      }
    />
  );
}
