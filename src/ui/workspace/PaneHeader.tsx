import { runCommand } from '@/commands/registry';
import { breadcrumbsFor } from '@/lib/paths';
import { useNav } from '@/state/nav';
import { IconBack, IconDots, IconEye, IconPencil } from '@/ui/icons';

/**
 * Obsidian's per-pane header (desktop only): back/forward history arrows,
 * centered breadcrumbs for the note's vault path, and the reading/editing
 * toggle + note-menu trigger. Rendered at the top of NoteScreen and EditScreen
 * in docked (desktop) mode, replacing the floating pencil/⋮ pill those
 * screens show on phones (SidebarToggle already renders nothing there).
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
  const crumbs = breadcrumbsFor(path);

  return (
    <div className="pane-header">
      <div className="pane-header__group">
        <button
          className="iconbtn pane-header__btn"
          aria-label="Back"
          disabled={!nav.canBack()}
          onClick={() => nav.back()}
        >
          <IconBack size={18} style={{ opacity: nav.canBack() ? 1 : 0.35 }} />
        </button>
        <button
          className="iconbtn pane-header__btn"
          aria-label="Forward"
          disabled={!nav.canForward()}
          onClick={() => nav.forward()}
        >
          <IconBack
            size={18}
            style={{ transform: 'rotate(180deg)', opacity: nav.canForward() ? 1 : 0.35 }}
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
      </div>
    </div>
  );
}
