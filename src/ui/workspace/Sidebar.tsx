import { useMemo, useRef, useState } from 'react';
import type { TreeFolder, TreeNode } from '@/lib/tree';
import { dirname, isHtmlPath, isMarkdownPath, noteTitle } from '@/lib/paths';
import {
  useSettings,
  useVault,
  vaultService,
  type NoteMeta,
  type SearchHit,
} from '@/services';
import { useNav, type SidebarView } from '@/state/nav';
import {
  IconChevronRight,
  IconFolder,
  IconFolderPlus,
  IconNote,
  IconNotePlus,
  IconSearch,
  IconSettings,
  IconStar,
  IconTag,
} from '@/ui/icons';
import { Dialog } from '@/ui/components/Dialog';
import { FileActionsSheet } from '@/ui/components/FileActionsSheet';
import { SyncStatus } from '@/ui/components/SyncStatus';
import { defaultNewNoteFolder } from '@/ui/templates';
import { VaultMenu } from './VaultMenu';

/** Shared with the desktop titlebar view-switcher cluster — same icons/order. */
export const VIEWS: {
  view: SidebarView;
  label: string;
  icon: (p: { size?: number }) => React.ReactNode;
}[] = [
  { view: 'files', label: 'Files', icon: (p) => <IconFolder {...p} /> },
  { view: 'search', label: 'Search', icon: (p) => <IconSearch {...p} /> },
  { view: 'tags', label: 'Tags', icon: (p) => <IconTag {...p} /> },
  { view: 'properties', label: 'All properties', icon: (p) => <IconNote {...p} /> },
  { view: 'bookmarks', label: 'Bookmarks', icon: (p) => <IconStar {...p} /> },
];

/**
 * Obsidian-style left sidebar: the active view fills the screen, a floating
 * pill switches views, and the vault bar (name, stats, settings) sits at the
 * bottom. Stays mounted; `open` drives the slide transition (swipes scrub it).
 */
export function Sidebar({ open }: { open: boolean }) {
  const nav = useNav();
  const view = useNav((s) => s.sidebarView);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const { settings } = useSettings();
  const files = useVault((s) => s.files);
  const current = VIEWS.find((v) => v.view === view) ?? VIEWS[0];

  const stats = useMemo(() => {
    const visible = files.filter((f) => !f.path.split('/').some((p) => p.startsWith('.')));
    const folders = new Set(
      visible.filter((f) => f.path.includes('/')).map((f) => f.path.slice(0, f.path.lastIndexOf('/'))),
    );
    return `${visible.length} files, ${folders.size} folders`;
  }, [files]);

  const vaultName =
    settings.vaults.find((v) => v.dir === settings.activeVault)?.name ??
    settings.repoUrl?.replace(/\.git$/, '').split('/').pop() ??
    'Vault';

  return (
    <div className="sidebar" data-open={open || undefined} aria-hidden={!open}>
      <div className="sidebar__content">
        {view === 'files' && <FilesPanel />}
        {view === 'search' && <SearchPanel />}
        {view === 'tags' && <TagsPanel />}
        {view === 'properties' && <PropertiesPanel />}
        {view === 'bookmarks' && <BookmarksPanel />}
      </div>

      {/* View switcher — collapsed pill or expanded list, as in Obsidian */}
      <div className="sidebar__switcher">
        {switcherOpen ? (
          <div className="switcher__list">
            {VIEWS.map((v) => (
              <button
                key={v.view}
                className="switcher__item"
                aria-pressed={v.view === view}
                onClick={() => {
                  nav.setSidebarView(v.view);
                  setSwitcherOpen(false);
                }}
              >
                <span className="row__icon">{v.icon({ size: 20 })}</span>
                {v.label}
              </button>
            ))}
          </div>
        ) : (
          <button className="switcher__pill" onClick={() => setSwitcherOpen(true)}>
            <span className="row__icon">{current.icon({ size: 20 })}</span>
            {current.label}
            <span style={{ flex: 1 }} />
            <IconChevronRight size={16} style={{ transform: 'rotate(-90deg)' }} />
          </button>
        )}
      </div>

      {/* Vault bar */}
      <div className="sidebar__vaultbar">
        <button className="vaultbar__name" onClick={() => setVaultMenuOpen(true)}>
          <span className="vaultbar__title">
            {vaultName}
            <IconChevronRight size={14} style={{ transform: 'rotate(90deg)', opacity: 0.6 }} />
          </span>
          <span className="vaultbar__stats">{stats}</span>
        </button>
        <SyncStatus />
        <button
          className="iconbtn vaultbar__gear"
          aria-label="Settings"
          onClick={() => nav.push({ name: 'settings' })}
        >
          <IconSettings />
        </button>
      </div>

      {vaultMenuOpen && <VaultMenu onClose={() => setVaultMenuOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Files — collapsible tree, active note highlighted, long-press drag to move
// ---------------------------------------------------------------------------

/** An armed/live note drag: ghost under the finger, folders as drop targets. */
interface TreeDrag {
  /** Path of the file being dragged. */
  path: string;
  /** Its home folder — dropping back there is a no-op, so it never highlights. */
  home: string;
  title: string;
  /** Folder under the finger ('' = vault root); null = nothing droppable. */
  target: string | null;
  /** Finger position at arm time, so the ghost's first paint is placed. */
  x: number;
  y: number;
}

/**
 * A pending file-actions sheet/menu: which node, and — only for a real
 * desktop right-click — the pointer position to anchor a compact context
 * menu at. Touch long-press (`onLongPress(node)`, no coords) always leaves
 * `anchor` undefined, so it keeps getting the mobile bottom sheet even in a
 * desktop-width browser window.
 */
interface ActionTarget {
  node: TreeNode;
  anchor?: { x: number; y: number };
}

function FilesPanel() {
  const tree = useVault((s) => s.tree);
  const sortOrder = useSettings((s) => s.settings.sortOrder);
  const { update } = useSettings();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const openActions = (node: TreeNode, x?: number, y?: number) =>
    setActionTarget({ node, anchor: x !== undefined && y !== undefined ? { x, y } : undefined });
  const [creatingFolder, setCreatingFolder] = useState(false);
  const creatingNote = useRef(false);
  const [drag, setDrag] = useState<TreeDrag | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  // One tree drag at a time — guards against two fingers each arming a drag.
  const dragging = useRef(false);

  /**
   * A note row's long-press armed: from here the finger owns the touch.
   * Releasing in place keeps the old behavior (the actions sheet); moving
   * drags a ghost across the tree — folders highlight as drop targets, the
   * panel auto-scrolls near its edges, and dropping on a folder (or the root
   * area) moves the file there. `data-tree-drag` tells DrawerGestures to keep
   * its hands off this touch; document-level listeners (passive: false, like
   * DrawerGestures) let us preventDefault the scroll React's handlers can't.
   */
  const beginDrag = (node: TreeNode, startX: number, startY: number, pointerId: number) => {
    // A second finger's 450ms hold must not arm a rival drag whose own onEnd
    // would also commit a move — one drag owns the tree at a time.
    if (dragging.current) return;
    dragging.current = true;
    const home = dirname(node.path);
    document.documentElement.setAttribute('data-tree-drag', '');
    const s = { x: startX, y: startY, moved: false, target: home as string | null, raf: 0 };

    // Follow only the finger that armed this drag; a second finger landing
    // mid-drag must not move the ghost or decide where the note lands.
    const mine = (list: TouchList): Touch | undefined =>
      Array.prototype.find.call(list, (t: Touch) => t.identifier === pointerId) as
        | Touch
        | undefined;

    const findTarget = (): string | null => {
      const el = document.elementFromPoint(s.x, s.y);
      // Folder rows target themselves; file rows target their parent folder
      // (dropping "onto a note" reads as "into its folder").
      const row = el?.closest<HTMLElement>('[data-drop-folder]');
      if (row) return row.dataset.dropFolder ?? '';
      return el?.closest('.filetree, .sidebar .sidebar__content') ? '' : null;
    };

    // One rAF loop for the whole drag: it pins the ghost to the finger,
    // auto-scrolls while the finger DWELLS near an edge (no move events fire
    // then, so a move-driven version would stall), and re-aims the target.
    const step = () => {
      s.raf = requestAnimationFrame(step);
      const ghost = ghostRef.current;
      if (ghost) ghost.style.transform = ghostTransform(s.x, s.y);
      const scroller = document.querySelector<HTMLElement>('.sidebar .sidebar__content');
      if (scroller && s.moved) {
        const r = scroller.getBoundingClientRect();
        if (s.y < r.top + 56) scroller.scrollTop -= 7;
        else if (s.y > r.bottom - 96) scroller.scrollTop += 7;
      }
      const target = s.moved ? findTarget() : home;
      if (target !== s.target) {
        s.target = target;
        setDrag((d) => (d ? { ...d, target } : d));
      }
    };

    const finish = () => {
      cancelAnimationFrame(s.raf);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
      document.documentElement.removeAttribute('data-tree-drag');
      dragging.current = false;
      setDrag(null);
    };

    const onMove = (e: TouchEvent) => {
      const t = mine(e.touches);
      if (!t) return;
      e.preventDefault(); // the note owns this touch — no scrolling under it
      if (Math.hypot(t.clientX - startX, t.clientY - startY) > 6) s.moved = true;
      s.x = t.clientX;
      s.y = t.clientY;
    };

    const onEnd = (e: TouchEvent) => {
      // Commit only when OUR finger lifts (or the whole gesture ends); another
      // finger's touchend must not drop this note at the first finger's
      // position. Empty changedTouches = a wholesale release, which is ours.
      if (e.changedTouches?.length && !mine(e.changedTouches)) return;
      // Cancel the touchend or the browser synthesizes a click at the finger —
      // it would land on whatever we render next (the sheet's scrim!) or, after
      // a drop, on the folder row under the ghost, and undo what we just did.
      if (e.cancelable) e.preventDefault();
      const { moved, target } = s;
      finish();
      if (!moved) {
        setActionTarget({ node }); // press-and-release: the actions sheet, as ever
        return;
      }
      if (target === null || target === home) return; // dropped nowhere / back home
      void (async () => {
        const to = await vaultService.moveFile(node.path, target);
        if (to !== node.path) useNav.getState().renamePath(node.path, to);
      })();
    };

    // Our finger being cancelled (or a wholesale cancel) ends the drag; a
    // stray cancel naming a different finger leaves ours running.
    const onCancel = (e: TouchEvent) => {
      if (!e.changedTouches?.length || mine(e.changedTouches)) finish();
    };

    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onCancel);
    setDrag({
      path: node.path,
      home,
      title: isMarkdownPath(node.path) ? noteTitle(node.path) : node.name,
      target: home,
      x: startX,
      y: startY,
    });
    s.raf = requestAnimationFrame(step);
  };

  // Obsidian: new note opens the editor on "Untitled" — no naming dialog.
  const newNote = async () => {
    if (creatingNote.current) return; // double-tap guard
    creatingNote.current = true;
    try {
      const path = await vaultService.createNote(defaultNewNoteFolder(), 'Untitled');
      useNav.getState().push({ name: 'edit', path });
    } finally {
      creatingNote.current = false;
    }
  };

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div
      className="filetree"
      data-drop-root={(drag && drag.target === '' && drag.home !== '') || undefined}
    >
      <div className="filetree__toolbar">
        <button
          className="iconbtn"
          aria-label={sortOrder === 'name' ? 'Sort by modified time' : 'Sort by name'}
          onClick={() => void update({ sortOrder: sortOrder === 'name' ? 'modified' : 'name' })}
          style={{ fontSize: 'var(--text-xs)', width: 'auto', padding: '0 10px', gap: 4 }}
        >
          {sortOrder === 'name' ? 'A–Z' : 'Recent'}
        </button>
        <span style={{ flex: 1 }} />
        <button className="iconbtn" aria-label="New folder" onClick={() => setCreatingFolder(true)}>
          <IconFolderPlus size={20} />
        </button>
        <button className="iconbtn" aria-label="New note" onClick={() => void newNote()}>
          <IconNotePlus size={20} />
        </button>
      </div>

      <TreeLevel
        folder={tree}
        depth={0}
        collapsed={collapsed}
        onToggle={toggle}
        onLongPress={openActions}
        onArm={beginDrag}
        drag={drag}
      />

      {drag && (
        <div
          className="tree-drag-ghost"
          ref={ghostRef}
          style={{ transform: ghostTransform(drag.x, drag.y) }}
        >
          <span className="tree-row__name">{drag.title}</span>
        </div>
      )}

      {actionTarget && (
        <FileActionsSheet
          node={actionTarget.node}
          anchor={actionTarget.anchor}
          onClose={() => setActionTarget(null)}
        />
      )}
      {/* Folders keep the dialog — they have no inline title to rename by. */}
      {creatingFolder && (
        <Dialog
          title="New folder"
          placeholder="Folder name"
          confirmLabel="Create"
          onCancel={() => setCreatingFolder(false)}
          onConfirm={async (name) => {
            setCreatingFolder(false);
            if (!name.trim()) return;
            await vaultService.createFolder(name.trim().replace(/[\\:]/g, '-'));
          }}
        />
      )}
    </div>
  );
}

/** Ghost sits beside the finger, floated up so the fingertip doesn't hide it. */
function ghostTransform(x: number, y: number): string {
  return `translate(${x + 12}px, ${y - 52}px)`;
}

function TreeLevel({
  folder,
  depth,
  collapsed,
  onToggle,
  onLongPress,
  onArm,
  drag,
}: {
  folder: TreeFolder;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  /** x/y present only for a real desktop right-click (see ActionTarget). */
  onLongPress: (node: TreeNode, x?: number, y?: number) => void;
  onArm: (node: TreeNode, x: number, y: number, id: number) => void;
  drag: TreeDrag | null;
}) {
  const sortOrder = useSettings((s) => s.settings.sortOrder);
  const files = useVault((s) => s.files);
  const nav = useNav();
  const screen = nav.tabs[nav.active].history[nav.tabs[nav.active].index];
  const activePath =
    screen.name === 'note' || screen.name === 'edit' || screen.name === 'artifact'
      ? screen.path
      : null;

  const children = useMemo(() => {
    if (sortOrder === 'name') return folder.children;
    const mtime = new Map(files.map((f) => [f.path, f.mtimeMs]));
    return [...folder.children].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      if (a.kind === 'folder') return a.name.localeCompare(b.name);
      return (mtime.get(b.path) ?? 0) - (mtime.get(a.path) ?? 0);
    });
  }, [folder.children, sortOrder, files]);

  return (
    <>
      {children.map((node) =>
        node.kind === 'folder' ? (
          <FolderRow
            key={node.path}
            node={node}
            depth={depth}
            collapsed={collapsed}
            onToggle={onToggle}
            onLongPress={onLongPress}
            onArm={onArm}
            drag={drag}
          />
        ) : (
          <FileRow
            key={node.path}
            node={node}
            depth={depth}
            active={node.path === activePath}
            onLongPress={onLongPress}
            onArm={onArm}
            drag={drag}
          />
        ),
      )}
    </>
  );
}

/**
 * Movement past this before the 450ms hold completes reads as a scroll, so it
 * cancels the press. Shared by folder rows (useLongPress) and file rows
 * (usePressDrag) — fingers are never perfectly still, so a zero-tolerance
 * cancel makes long-press feel broken.
 */
const PRESS_SLOP = 8;

function useLongPress(fire: (x?: number, y?: number) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  return {
    fired,
    handlers: {
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (t) start.current = { x: t.clientX, y: t.clientY };
        fired.current = false;
        timer.current = setTimeout(() => {
          timer.current = null;
          fired.current = true;
          fire(); // touch long-press: no pointer coords, always the sheet
        }, 450);
      },
      onTouchMove: (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (!timer.current || !t) return;
        if (Math.hypot(t.clientX - start.current.x, t.clientY - start.current.y) > PRESS_SLOP) {
          clearTimeout(timer.current);
          timer.current = null;
        }
      },
      onTouchEnd: () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
      },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        // Real right-click: pass the pointer position through so desktop can
        // anchor a compact context menu there instead of the bottom sheet.
        fire(e.clientX, e.clientY);
      },
    },
  };
}

/**
 * File rows: a long-press ARMS the drag layer instead of opening the sheet
 * outright — beginDrag then decides between release (actions sheet, the old
 * behavior) and move (drag). Pre-arm jitter under 8px keeps the timer alive
 * (fingers are never perfectly still); a real scroll kills it, as before.
 * Desktop right-click skips straight to the sheet — there is no drag there.
 */
function usePressDrag(
  arm: (x: number, y: number, id: number) => void,
  sheet: (x?: number, y?: number) => void,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const start = useRef({ x: 0, y: 0, id: -1 });
  const touched = useRef(false);
  return {
    fired,
    handlers: {
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0];
        touched.current = true;
        start.current = { x: t.clientX, y: t.clientY, id: t.identifier };
        fired.current = false;
        timer.current = setTimeout(() => {
          timer.current = null;
          fired.current = true;
          arm(start.current.x, start.current.y, start.current.id);
        }, 450);
      },
      onTouchMove: (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (!timer.current || !t) return;
        if (Math.hypot(t.clientX - start.current.x, t.clientY - start.current.y) > PRESS_SLOP) {
          clearTimeout(timer.current);
          timer.current = null;
        }
      },
      onTouchEnd: () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
      },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        // Android raises `contextmenu` from a long-press ~500ms in, racing the
        // drag we ARM at 450ms — opening the sheet here would abort the drag
        // ("dragging opens the options menu"). On touch the sheet is reached by
        // arming then releasing in place (see beginDrag); only a real mouse
        // right-click, which never fires touchstart, opens it from here.
        if (touched.current) return;
        sheet(e.clientX, e.clientY);
      },
    },
  };
}

function FolderRow({
  node,
  depth,
  collapsed,
  onToggle,
  onLongPress,
  onArm,
  drag,
}: {
  node: TreeFolder;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onLongPress: (n: TreeNode, x?: number, y?: number) => void;
  onArm: (n: TreeNode, x: number, y: number, id: number) => void;
  drag: TreeDrag | null;
}) {
  const isCollapsed = collapsed.has(node.path);
  // Folders aren't draggable (v1) — long-press keeps opening the sheet directly.
  const { handlers, fired } = useLongPress((x, y) => onLongPress(node, x, y));
  // Drop target under the dragged note's finger — never its own home folder.
  const isDrop = drag !== null && drag.target === node.path && drag.home !== node.path;

  return (
    <>
      <button
        className={isDrop ? 'tree-row tree-row--folder tree-row--drop' : 'tree-row tree-row--folder'}
        style={{ paddingLeft: 10 + depth * 18 }}
        data-drop-folder={node.path}
        {...handlers}
        onClick={() => {
          if (!fired.current) onToggle(node.path);
        }}
      >
        <IconChevronRight
          size={16}
          className="tree-row__chevron"
          style={{ transform: isCollapsed ? undefined : 'rotate(90deg)' }}
        />
        <span className="tree-row__name">{node.name}</span>
      </button>
      {!isCollapsed && (
        <TreeLevel
          folder={node}
          depth={depth + 1}
          collapsed={collapsed}
          onToggle={onToggle}
          onLongPress={onLongPress}
          onArm={onArm}
          drag={drag}
        />
      )}
    </>
  );
}

function FileRow({
  node,
  depth,
  active,
  onLongPress,
  onArm,
  drag,
}: {
  node: TreeNode;
  depth: number;
  active: boolean;
  onLongPress: (n: TreeNode, x?: number, y?: number) => void;
  onArm: (n: TreeNode, x: number, y: number, id: number) => void;
  drag: TreeDrag | null;
}) {
  const { handlers, fired } = usePressDrag(
    (x, y, id) => onArm(node, x, y, id),
    (x, y) => onLongPress(node, x, y),
  );
  const isMd = isMarkdownPath(node.path);
  const isArtifact = isHtmlPath(node.path);
  const classes = ['tree-row'];
  if (active) classes.push('tree-row--active');
  if (drag?.path === node.path) classes.push('tree-row--drag-source');
  return (
    <button
      className={classes.join(' ')}
      style={{ paddingLeft: 28 + depth * 18 }}
      // Dropping on a note reads as "into its folder" — target the parent.
      data-drop-folder={dirname(node.path)}
      {...handlers}
      onClick={() => {
        if (fired.current) return;
        if (isMd) useNav.getState().push({ name: 'note', path: node.path });
        else if (isArtifact) useNav.getState().push({ name: 'artifact', path: node.path });
      }}
    >
      <span className="tree-row__name">
        {isMd || isArtifact ? noteTitle(node.path) : node.name}
        {!isMd && <span className="tree-row__ext"> {node.name.split('.').pop()}</span>}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function SearchPanel() {
  const seed = useNav((s) => s.searchSeed);
  const [query, setQuery] = useState(seed ?? '');
  const lastSeed = useRef(seed);
  if (seed !== lastSeed.current) {
    lastSeed.current = seed;
    if (seed !== null) setQuery(seed);
  }
  const indexVersion = useVault((s) => s.indexVersion);

  const hits: SearchHit[] = useMemo(
    () => vaultService.searchNotes(query, 50),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, indexVersion],
  );

  const terms = useMemo(
    () =>
      query
        .split(/\s+/)
        .filter((w) => w && !/^(tag|path|file):/i.test(w)),
    [query],
  );

  return (
    <div className="sidebar-panel">
      <input
        className="search-input"
        style={{ margin: '10px 12px', width: 'calc(100% - 24px)' }}
        placeholder="Search… (tag: path: file:)"
        value={query}
        autoFocus={!seed}
        onChange={(e) => setQuery(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
      />
      {query.trim() === '' && (
        <p className="state__hint" style={{ padding: '20px 16px' }}>
          Search every note in this vault. Narrow results with <code>tag:x</code>,{' '}
          <code>path:folder</code> or <code>file:name</code>.
        </p>
      )}
      {query.trim() !== '' && hits.length === 0 && (
        <p className="state__hint" style={{ padding: '20px 16px' }}>
          No matches. Operators: <code>tag:x</code> <code>path:folder</code> <code>file:name</code>
        </p>
      )}
      {hits.map((h) => (
        <button
          key={h.path}
          className="tree-row"
          style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, height: 'auto', minHeight: 44 }}
          onClick={() => useNav.getState().push({ name: 'note', path: h.path })}
        >
          <span className="tree-row__name" style={{ fontWeight: 550 }}>
            {highlightTerms(h.title, terms)}
          </span>
          {h.excerpt && <span className="hit__excerpt">{highlightTerms(h.excerpt, terms)}</span>}
        </button>
      ))}
    </div>
  );
}

/** Wrap query terms in <mark> so hits show why they matched. */
function highlightTerms(text: string, terms: string[]): React.ReactNode {
  if (terms.length === 0) return text;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'ig');
  const parts = text.split(re);
  if (parts.length === 1) return text;
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

function TagsPanel() {
  const indexVersion = useVault((s) => s.indexVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tags = useMemo(() => vaultService.tagCounts(), [indexVersion]);
  const nav = useNav();

  if (tags.length === 0) {
    return <p className="state__hint" style={{ padding: '24px 16px' }}>No tags in this vault yet.</p>;
  }
  return (
    <div className="sidebar-panel" style={{ paddingTop: 6 }}>
      {tags.map(({ tag, count }) => (
        <button
          key={tag}
          className="tree-row"
          onClick={() => {
            nav.seedSearch(`tag:${tag}`);
          }}
        >
          <span className="row__icon">
            <IconTag size={16} />
          </span>
          <span className="tree-row__name">{tag}</span>
          <span className="tree-row__count">{count}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// All properties
// ---------------------------------------------------------------------------

function PropertiesPanel() {
  const indexVersion = useVault((s) => s.indexVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const props = useMemo(() => vaultService.propertyCounts(), [indexVersion]);
  const [open, setOpen] = useState<string | null>(null);
  const notes: NoteMeta[] = useMemo(
    () => (open ? vaultService.notesWithProperty(open) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, indexVersion],
  );

  if (props.length === 0) {
    return (
      <p className="state__hint" style={{ padding: '24px 16px' }}>
        No frontmatter properties in this vault yet.
      </p>
    );
  }
  return (
    <div className="sidebar-panel" style={{ paddingTop: 6 }}>
      {props.map(({ key, count }) => (
        <div key={key}>
          <button className="tree-row" onClick={() => setOpen(open === key ? null : key)}>
            <IconChevronRight
              size={16}
              className="tree-row__chevron"
              style={{ transform: open === key ? 'rotate(90deg)' : undefined }}
            />
            <span className="tree-row__name">{key}</span>
            <span className="tree-row__count">{count}</span>
          </button>
          {open === key &&
            notes.map((n) => (
              <button
                key={n.path}
                className="tree-row"
                style={{ paddingLeft: 34 }}
                onClick={() => useNav.getState().push({ name: 'note', path: n.path })}
              >
                <span className="tree-row__name">{n.title}</span>
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

function BookmarksPanel() {
  const bookmarks = useVault((s) => s.bookmarks);
  const notes = useVault((s) => s.notes);

  if (bookmarks.length === 0) {
    return (
      <p className="state__hint" style={{ padding: '24px 16px' }}>
        Bookmark notes from the note menu and they'll gather here (synced across your devices).
      </p>
    );
  }
  return (
    <div className="sidebar-panel" style={{ paddingTop: 6 }}>
      {bookmarks.map((path) => (
        <button
          key={path}
          className="tree-row"
          onClick={() => useNav.getState().push({ name: 'note', path })}
        >
          <span className="row__icon">
            <IconStar size={16} />
          </span>
          <span className="tree-row__name">{notes.get(path)?.title ?? noteTitle(path)}</span>
        </button>
      ))}
    </div>
  );
}
