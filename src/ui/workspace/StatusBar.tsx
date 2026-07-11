import { useMemo } from 'react';
import { parseFrontmatter } from '@/lib/frontmatter';
import { countChars, countWords } from '@/lib/noteStats';
import { useVault, vaultService } from '@/services';
import { currentScreen, useNav } from '@/state/nav';

/**
 * Obsidian's bottom-right status bar (desktop only): backlink, property, word
 * and character counts for the note in the center pane. Backlinks reuse the
 * exact same `vaultService.backlinksOf` call RightSidebar renders from — no
 * separate counting logic. Word/char counts read the same content cache the
 * reader and editor's autosave keep warm (`vaultService.noteContent`), so
 * editing counts follow the draft rather than the last git commit. Hidden on
 * every screen but the reader/editor.
 */
export function StatusBar() {
  const nav = useNav();
  const screen = currentScreen(nav);
  // Bumped by vaultService on every write (autosave included) and on every
  // note load (touchRecents) — the two events that can change these counts.
  const indexVersion = useVault((s) => s.indexVersion);
  const recentsHead = useVault((s) => s.recents[0]);

  const path = screen.name === 'note' || screen.name === 'edit' ? screen.path : null;

  const stats = useMemo(() => {
    if (path === null) return null;
    const text = vaultService.noteContent(path) ?? '';
    const fm = parseFrontmatter(text);
    return {
      backlinks: vaultService.backlinksOf(path).length,
      properties: Object.keys(fm.data).length,
      words: countWords(fm.body),
      chars: countChars(fm.body),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, indexVersion, recentsHead]);

  if (path === null || stats === null) return null;

  // Gap-separated segments, like Obsidian's status bar — no middots.
  return (
    <div className="status-bar">
      <span>{stats.backlinks} backlinks</span>
      <span>{stats.properties} properties</span>
      <span>{stats.words} words</span>
      <span>{stats.chars} characters</span>
    </div>
  );
}
