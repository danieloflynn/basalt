import { parseFrontmatter } from '@/lib/frontmatter';
import { noteTitle } from '@/lib/paths';
import { applyTaskSort, sortToggledTask, toggleTaskAtLine } from '@/lib/tasks';
import { useSettings, useVault, vaultService } from '@/services';
import { useNav } from '@/state/nav';
import { IconX } from '@/ui/icons';
import { Markdown } from '@/ui/markdown/Markdown';

/**
 * Obsidian's "Open to the right" (v1 of split panes): a second READING pane
 * docked as its own grid column between the main pane and the backlinks
 * column. One note, reading view only; links inside it navigate the MAIN
 * pane (the split is reference material and stays put), tasks toggle and
 * write through like the reader. Desktop-only — App mounts it only in
 * docked mode, and only the desktop file-tree / note menus can open it.
 *
 * Unlike NoteScreen (which owns its text state), this subscribes to
 * indexVersion and reads the write-through content cache every render, so
 * edits made in the main editor show up here live.
 */
export function SplitPane({ path }: { path: string }) {
  const closeSplit = useNav((s) => s.closeSplit);
  useVault((s) => s.indexVersion);
  const raw = vaultService.noteContent(path);
  const fm = raw !== undefined ? parseFrontmatter(raw) : null;
  const fmLineOffset = fm?.raw != null ? fm.raw.split('\n').length + 2 : 0;

  const toggleTask = (line: number) => {
    if (raw === undefined) return;
    let updated = toggleTaskAtLine(raw, line + fmLineOffset);
    if (updated === null) return;
    if (useSettings.getState().settings.sortCheckedToBottom) {
      const region = sortToggledTask(updated, line + fmLineOffset);
      if (region) updated = applyTaskSort(updated, region);
    }
    void vaultService.writeNote(path, updated);
  };

  return (
    <div className="split-pane">
      <header className="pane-header">
        <div className="pane-header__crumbs">
          <span className="pane-header__crumb pane-header__crumb--leaf">{noteTitle(path)}</span>
        </div>
        <div className="pane-header__group">
          <button
            className="iconbtn pane-header__btn"
            aria-label="Close split pane"
            onClick={closeSplit}
          >
            <IconX size={18} />
          </button>
        </div>
      </header>
      <div className="scroll">
        {fm === null ? (
          <div className="state">
            <p className="state__hint">This note is no longer in the vault.</p>
          </div>
        ) : (
          <>
            <h1 className="split-pane__title">{noteTitle(path)}</h1>
            <Markdown source={fm.body} path={path} onToggleTask={toggleTask} />
          </>
        )}
      </div>
    </div>
  );
}
