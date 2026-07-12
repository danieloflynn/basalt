import { useMemo, useState, type ReactNode } from 'react';
import { parseFrontmatter } from '@/lib/frontmatter';
import type { HeadingInfo } from '@/lib/outline';
import { basename, isHtmlPath, noteTitle, stripExt } from '@/lib/paths';
import { stripInlineMarkdown } from '@/lib/plaintext';
import { parseWikilinks } from '@/lib/wikilinks';
import { useVault, vaultService } from '@/services';
import { currentScreen, openNote, useNav } from '@/state/nav';
import { IconChevronRight, IconList, IconWikilink } from '@/ui/icons';

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

type RightTab = 'backlinks' | 'outline';

const UNLINKED_MIN_TITLE_LENGTH = 3;
const UNLINKED_MENTIONS_CAP = 20;
const UNLINKED_CONTEXT_RADIUS = 40;

interface UnlinkedMention {
  path: string;
  title: string;
  context: ReactNode;
}

/** ±40-char context window around a plain-text match, the hit wrapped in <mark>. */
function unlinkedMentionContext(text: string, index: number, length: number): ReactNode {
  const start = Math.max(0, index - UNLINKED_CONTEXT_RADIUS);
  const end = Math.min(text.length, index + length + UNLINKED_CONTEXT_RADIUS);
  return (
    <>
      {start > 0 ? '…' : ''}
      {text.slice(start, index)}
      <mark>{text.slice(index, index + length)}</mark>
      {text.slice(index + length, end)}
      {end < text.length ? '…' : ''}
    </>
  );
}

/**
 * Obsidian's right sidebar: the current note's backlinks ("Linked mentions").
 * Always mounted like the left drawer — `data-open` drives the CSS slide and
 * DrawerGestures scrubs the same transform inline while a finger drags — so
 * never mount it conditionally. Tapping a mention navigates there; nav.push
 * closes the drawer as a side effect.
 *
 * Desktop renders a richer, Obsidian-Mac-style panel: an icon tab row
 * (Backlinks / Outline) above collapsible per-source groups, a collapse-all
 * toolbar, boxed mention snippets, and (Backlinks tab only) a collapsed-by-
 * default "Unlinked mentions" section. Mobile keeps the original flat list
 * byte-for-byte — this is ALSO the mobile backlinks drawer and its 94-spec
 * Playwright suite must stay pixel-identical.
 */
export function RightSidebar({ open }: { open: boolean }) {
  const nav = useNav();
  const desktop = useNav((s) => s.desktop);
  const indexVersion = useVault((s) => s.indexVersion);
  const screen = currentScreen(nav);
  const path = screen.name === 'note' || screen.name === 'edit' ? screen.path : null;

  const backlinks = useMemo(
    () => (path ? vaultService.backlinksOf(path) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, indexVersion],
  );

  // Desktop-only: which source-note groups are folded shut. Local UI state,
  // not a setting — resets naturally on reload, nothing to persist.
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const allCollapsed = backlinks.length > 0 && backlinks.every((b) => collapsedPaths.has(b.path));

  const toggleGroup = (p: string) =>
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const toggleAll = () =>
    setCollapsedPaths(allCollapsed ? new Set() : new Set(backlinks.map((b) => b.path)));

  // Desktop-only: the active icon tab, default Backlinks.
  const [activeTab, setActiveTab] = useState<RightTab>('backlinks');

  // Desktop-only: is the "Unlinked mentions" section expanded? Collapsed by
  // default (Obsidian's default), a separate toggle from the per-source groups.
  const [unlinkedOpen, setUnlinkedOpen] = useState(false);

  // Desktop-only: the current note's heading outline, reusing the exact
  // extraction NoteInfoSheet uses (vaultService.outlineOf -> lib/outline's
  // extractOutline, headings already carry a precomputed slug).
  const outline = useMemo<HeadingInfo[]>(
    () => (path ? vaultService.outlineOf(path) : []),
    [path, indexVersion],
  );

  // Desktop-only, Backlinks tab: Obsidian's "Unlinked mentions" — other notes
  // whose TEXT contains this note's title but don't already link to it.
  // `vaultService.noteContent` is a synchronous in-memory cache (populated at
  // vault load and kept write-through on every save), so this can run in a
  // plain useMemo without deferring to an effect or blocking render.
  const unlinkedMentions = useMemo<UnlinkedMention[]>(() => {
    if (!path) return [];
    const title = noteTitle(path);
    if (title.length < UNLINKED_MIN_TITLE_LENGTH) return [];
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
    // Notes already in the linked-mentions list are excluded wholesale — any
    // wikilink resolving to this note already puts the source note there, so
    // a residual plain-text match in the same note is never "unlinked".
    const linked = new Set(backlinks.map((b) => b.path));
    const out: UnlinkedMention[] = [];
    const candidates = [...useVault.getState().notes.keys()].sort();
    for (const candidate of candidates) {
      if (candidate === path || linked.has(candidate)) continue;
      const raw = vaultService.noteContent(candidate);
      if (!raw) continue;
      const text = stripInlineMarkdown(parseFrontmatter(raw).body);
      const m = pattern.exec(text);
      if (!m) continue;
      out.push({
        path: candidate,
        title: noteTitle(candidate),
        context: unlinkedMentionContext(text, m.index, m[0].length),
      });
      if (out.length >= UNLINKED_MENTIONS_CAP) break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, indexVersion]);

  // A backlink source can be an HTML artifact — open it in the sandboxed
  // viewer, never the markdown reader/editor (which would render raw HTML
  // and, in editing mode, let an autosave add the artifact to the notes
  // map / search index).
  const openBacklink = (p: string) => {
    if (isHtmlPath(p)) useNav.getState().push({ name: 'artifact', path: p });
    else openNote(p);
  };

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
          {desktop ? (
            <>
              <div className="rightbar__tabs" role="tablist" aria-label="Right sidebar views">
                <button
                  type="button"
                  className="rightbar__tab"
                  role="tab"
                  aria-selected={activeTab === 'backlinks'}
                  data-active={activeTab === 'backlinks' || undefined}
                  aria-label="Backlinks"
                  title="Backlinks"
                  onClick={() => setActiveTab('backlinks')}
                >
                  <IconWikilink size={16} />
                </button>
                <button
                  type="button"
                  className="rightbar__tab"
                  role="tab"
                  aria-selected={activeTab === 'outline'}
                  data-active={activeTab === 'outline' || undefined}
                  aria-label="Outline"
                  title="Outline"
                  onClick={() => setActiveTab('outline')}
                >
                  <IconList size={16} />
                </button>
              </div>

              {activeTab === 'backlinks' ? (
                path === null ? (
                  <p className="state__hint" style={{ padding: '20px 12px' }}>
                    No backlinks. Open a note to see which notes link to it.
                  </p>
                ) : (
                  <>
                    {backlinks.length > 0 && (
                      <div className="rightbar__toolbar">
                        <button
                          type="button"
                          className="iconbtn rightbar__toolbtn"
                          aria-label="Collapse results"
                          aria-pressed={allCollapsed}
                          data-active={allCollapsed || undefined}
                          onClick={toggleAll}
                        >
                          <IconList size={16} />
                        </button>
                      </div>
                    )}
                    <div className="rightbar__title-row">
                      <span className="rightbar__title">Linked mentions</span>
                      {/* Total counts occurrences, not source notes — Obsidian's
                          header number. */}
                      <span className="rightbar__total">
                        {backlinks.reduce((n, b) => n + b.contexts.length, 0)}
                      </span>
                    </div>
                    {backlinks.length === 0 && (
                      <p className="state__hint" style={{ padding: '12px' }}>
                        No other notes link here yet.
                      </p>
                    )}
                    {backlinks.map((b) => {
                      const isCollapsed = collapsedPaths.has(b.path);
                      return (
                        <div className="rightbar__group" key={b.path}>
                          <div
                            className="rightbar__group-head"
                            role="button"
                            tabIndex={0}
                            aria-expanded={!isCollapsed}
                            onClick={() => toggleGroup(b.path)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleGroup(b.path);
                              }
                            }}
                          >
                            <IconChevronRight
                              size={14}
                              className="rightbar__group-chevron"
                              style={{ transform: isCollapsed ? undefined : 'rotate(90deg)' }}
                            />
                            <button
                              type="button"
                              className="rightbar__group-title"
                              onClick={(e) => {
                                e.stopPropagation();
                                openBacklink(b.path);
                              }}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              {b.title}
                            </button>
                            <span className="rightbar__group-count">{b.contexts.length}</span>
                          </div>
                          {!isCollapsed &&
                            b.contexts.map(
                              (context, i) =>
                                context && (
                                  <button
                                    key={i}
                                    type="button"
                                    className="rightbar__mention"
                                    onClick={() => openBacklink(b.path)}
                                  >
                                    <span className="hit__excerpt">
                                      {backlinkContext(context, noteTitle(path))}
                                    </span>
                                  </button>
                                ),
                            )}
                        </div>
                      );
                    })}

                    {unlinkedMentions.length > 0 && (
                      <div className="rightbar__unlinked">
                        <div
                          className="rightbar__group-head"
                          role="button"
                          tabIndex={0}
                          aria-expanded={unlinkedOpen}
                          onClick={() => setUnlinkedOpen((v) => !v)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setUnlinkedOpen((v) => !v);
                            }
                          }}
                        >
                          <IconChevronRight
                            size={14}
                            className="rightbar__group-chevron"
                            style={{ transform: unlinkedOpen ? 'rotate(90deg)' : undefined }}
                          />
                          <span className="rightbar__group-title" style={{ cursor: 'default' }}>
                            Unlinked mentions
                          </span>
                          <span className="rightbar__group-count">{unlinkedMentions.length}</span>
                        </div>
                        {unlinkedOpen &&
                          unlinkedMentions.map((m) => (
                            <div className="rightbar__group" key={m.path}>
                              <div className="rightbar__group-head">
                                <button
                                  type="button"
                                  className="rightbar__group-title"
                                  onClick={() => openBacklink(m.path)}
                                >
                                  {m.title}
                                </button>
                              </div>
                              <button
                                type="button"
                                className="rightbar__mention"
                                onClick={() => openBacklink(m.path)}
                              >
                                <span className="hit__excerpt">{m.context}</span>
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </>
                )
              ) : path === null ? (
                <p className="state__hint" style={{ padding: '20px 12px' }}>
                  No note open. Open a note to see its outline.
                </p>
              ) : outline.length === 0 ? (
                <p className="state__hint" style={{ padding: '20px 12px' }}>
                  No headings in this note.
                </p>
              ) : (
                <div className="rightbar__outline">
                  {outline.map((h, i) => (
                    <button
                      key={`${h.slug}-${i}`}
                      type="button"
                      className="rightbar__outline-item"
                      style={{ paddingLeft: 12 + (h.level - 1) * 14 }}
                      onClick={() => useNav.getState().push({ name: 'note', path, heading: h.slug })}
                    >
                      {h.text}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : path === null ? (
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
