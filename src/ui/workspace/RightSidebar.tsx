import { useMemo, type ReactNode } from 'react';
import { basename, isHtmlPath, noteTitle, stripExt } from '@/lib/paths';
import { stripInlineMarkdown } from '@/lib/plaintext';
import { parseWikilinks } from '@/lib/wikilinks';
import { useVault, vaultService } from '@/services';
import { currentScreen, openNote, useNav } from '@/state/nav';

/**
 * Render a backlink's context line the way search excerpts read: inline markdown
 * stripped to plain text, with the current note's mention wrapped in <mark>.
 * Aliased links ([[Welcome|home]]) strip to their alias, so we mark that too —
 * best-effort, since the plain text shows the alias rather than the note name.
 */
export function backlinkContext(raw: string, title: string): ReactNode {
  const text = stripInlineMarkdown(raw);
  const needles = new Set<string>([title]);
  for (const link of parseWikilinks(raw)) {
    const base = link.target ? stripExt(basename(link.target)) : '';
    if (link.alias && base.toLowerCase() === title.toLowerCase()) needles.add(link.alias);
  }
  const escaped = [...needles]
    .filter(Boolean)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return text;
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'ig'));
  if (parts.length === 1) return text;
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

/**
 * Obsidian's right sidebar: the current note's backlinks ("Linked mentions").
 * Always mounted like the left drawer — `data-open` drives the CSS slide and
 * DrawerGestures scrubs the same transform inline while a finger drags — so
 * never mount it conditionally. Tapping a mention navigates there; nav.push
 * closes the drawer as a side effect.
 */
export function RightSidebar({ open }: { open: boolean }) {
  const nav = useNav();
  const indexVersion = useVault((s) => s.indexVersion);
  const screen = currentScreen(nav);
  const path = screen.name === 'note' || screen.name === 'edit' ? screen.path : null;

  const backlinks = useMemo(
    () => (path ? vaultService.backlinksOf(path) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, indexVersion],
  );

  return (
    <>
      <div
        className="scrim scrim--rightbar"
        data-open={open || undefined}
        onClick={() => nav.closeRightSidebar()}
      />
      <div className="sidebar-right" data-open={open || undefined} aria-hidden={!open}>
        <div className="rightbar__head">
          Backlinks
          {path !== null && <span className="rightbar__count">{backlinks.length}</span>}
        </div>
        <div className="sidebar__content">
          {path === null ? (
            // Obsidian keeps the panel up without a note — just says so.
            <p className="state__hint" style={{ padding: '20px 12px' }}>
              No backlinks. Open a note to see which notes link to it.
            </p>
          ) : (
            <>
              <p className="rightbar__section">Linked mentions</p>
              {backlinks.length === 0 && (
                <p className="state__hint" style={{ padding: '12px' }}>
                  No other notes link here yet.
                </p>
              )}
              {backlinks.map((b) => (
                <button
                  key={b.path}
                  className="tree-row"
                  style={{
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 2,
                    height: 'auto',
                    minHeight: 44,
                  }}
                  onClick={() => {
                    // A backlink source can be an HTML artifact — open it in the
                    // sandboxed viewer, never the markdown reader/editor (which
                    // would render raw HTML and, in editing mode, let an autosave
                    // add the artifact to the notes map / search index).
                    if (isHtmlPath(b.path)) useNav.getState().push({ name: 'artifact', path: b.path });
                    else openNote(b.path);
                  }}
                >
                  <span className="tree-row__name" style={{ fontWeight: 550 }}>
                    {b.title}
                  </span>
                  {b.context && (
                    <span className="hit__excerpt">
                      {backlinkContext(b.context, noteTitle(path))}
                    </span>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
