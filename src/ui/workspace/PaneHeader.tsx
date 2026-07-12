import { runCommand } from '@/commands/registry';
import { breadcrumbsFor } from '@/lib/paths';
import { useNav } from '@/state/nav';
import { IconBack, IconDots, IconEye, IconPencil, IconX } from '@/ui/icons';
import { usePane } from '@/ui/workspace/PaneContext';

/**
 * Obsidian's per-pane header (desktop only): back/forward history arrows,
 * centered breadcrumbs for the note's vault path, and the reading/editing
 * toggle + note-menu trigger. Rendered at the top of NoteScreen and EditScreen
 * in docked (desktop) mode, replacing the floating pencil/⋮ pill those
 * screens show on phones (SidebarToggle already renders nothing there).
 *
 * Pane-aware: the arrows display THEIR pane's history state (both panes'
 * headers render at once), while the click actions route through the focused
 * pane — the capturing mousedown in App focuses this pane before the click
 * lands. Inside the split pane, a close-split ✕ joins the right-hand group.
 */
export function PaneHeader({
  path,
  mode,
  onOpenMenu,
}: {
  path: string;
  mode: 'reading' | 'editing';
  onOpenMenu: () => void;
}) {
  const nav = useNav();
  const pane = usePane();
  const crumbs = breadcrumbsFor(path);
  const canBack = nav.canBackIn(pane);
  const canForward = nav.canForwardIn(pane);

  return (
    <div className="pane-header">
      <div className="pane-header__group">
        <button
          className="iconbtn pane-header__btn"
          aria-label="Back"
          disabled={!canBack}
          onClick={() => nav.back()}
        >
          <IconBack size={18} style={{ opacity: canBack ? 1 : 0.35 }} />
        </button>
        <button
          className="iconbtn pane-header__btn"
          aria-label="Forward"
          disabled={!canForward}
          onClick={() => nav.forward()}
        >
          <IconBack
            size={18}
            style={{ transform: 'rotate(180deg)', opacity: canForward ? 1 : 0.35 }}
          />
        </button>
      </div>

      <div className="pane-header__crumbs">
        {crumbs.map((c, i) =>
          c.isLeaf ? (
            <span key={i} className="pane-header__crumb pane-header__crumb--leaf">
              {c.label}
            </span>
          ) : (
            <span key={i} className="pane-header__crumb-wrap">
              <button
                className="pane-header__crumb pane-header__crumb--link"
                onClick={() => nav.openSidebar('files')}
              >
                {c.label}
              </button>
              <span className="pane-header__sep" aria-hidden="true">
                {' / '}
              </span>
            </span>
          ),
        )}
      </div>

      <div className="pane-header__group">
        <button
          className="iconbtn pane-header__btn"
          aria-label={mode === 'reading' ? 'Edit note' : 'Reading view'}
          onClick={() => runCommand('toggle-view-mode')}
        >
          {mode === 'reading' ? <IconPencil size={20} /> : <IconEye size={20} />}
        </button>
        <button className="iconbtn pane-header__btn" aria-label="Note menu" onClick={onOpenMenu}>
          <IconDots size={20} />
        </button>
        {pane === 'split' && (
          <button
            className="iconbtn pane-header__btn"
            aria-label="Close split pane"
            onClick={() => nav.closeSplit()}
          >
            <IconX size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
