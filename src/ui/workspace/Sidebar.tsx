import { useMemo, useRef, useState } from 'react';
import type { TreeFolder, TreeNode } from '@/lib/tree';
import { noteTitle } from '@/lib/paths';
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
import { VaultMenu } from './VaultMenu';

const VIEWS: {
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
// Files — collapsible tree, active note highlighted
// ---------------------------------------------------------------------------

function FilesPanel() {
  const tree = useVault((s) => s.tree);
  const sortOrder = useSettings((s) => s.settings.sortOrder);
  const { update } = useSettings();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [actionTarget, setActionTarget] = useState<TreeNode | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const creatingNote = useRef(false);

  // Obsidian: new note opens the editor on "Untitled" — no naming dialog.
  const newNote = async () => {
    if (creatingNote.current) return; // double-tap guard
    creatingNote.current = true;
    try {
      const path = await vaultService.createNote('', 'Untitled');
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
    <div className="filetree">
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
        onLongPress={setActionTarget}
      />

      {actionTarget && (
        <FileActionsSheet node={actionTarget} onClose={() => setActionTarget(null)} />
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

function TreeLevel({
  folder,
  depth,
  collapsed,
  onToggle,
  onLongPress,
}: {
  folder: TreeFolder;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onLongPress: (node: TreeNode) => void;
}) {
  const sortOrder = useSettings((s) => s.settings.sortOrder);
  const files = useVault((s) => s.files);
  const nav = useNav();
  const screen = nav.tabs[nav.active].history[nav.tabs[nav.active].index];
  const activePath = screen.name === 'note' || screen.name === 'edit' ? screen.path : null;

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
          />
        ) : (
          <FileRow
            key={node.path}
            node={node}
            depth={depth}
            active={node.path === activePath}
            onLongPress={onLongPress}
          />
        ),
      )}
    </>
  );
}

function useLongPress(fire: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  return {
    fired,
    handlers: {
      onTouchStart: () => {
        fired.current = false;
        timer.current = setTimeout(() => {
          fired.current = true;
          fire();
        }, 450);
      },
      onTouchMove: () => {
        if (timer.current) clearTimeout(timer.current);
      },
      onTouchEnd: () => {
        if (timer.current) clearTimeout(timer.current);
      },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        fire();
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
}: {
  node: TreeFolder;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onLongPress: (n: TreeNode) => void;
}) {
  const isCollapsed = collapsed.has(node.path);
  const { handlers, fired } = useLongPress(() => onLongPress(node));

  return (
    <>
      <button
        className="tree-row tree-row--folder"
        style={{ paddingLeft: 10 + depth * 18 }}
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
}: {
  node: TreeNode;
  depth: number;
  active: boolean;
  onLongPress: (n: TreeNode) => void;
}) {
  const { handlers, fired } = useLongPress(() => onLongPress(node));
  const isMd = node.path.toLowerCase().endsWith('.md');
  return (
    <button
      className={active ? 'tree-row tree-row--active' : 'tree-row'}
      style={{ paddingLeft: 28 + depth * 18 }}
      {...handlers}
      onClick={() => {
        if (fired.current || !isMd) return;
        useNav.getState().push({ name: 'note', path: node.path });
      }}
    >
      <span className="tree-row__name">
        {isMd ? noteTitle(node.path) : node.name}
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
        Bookmark notes from the note menu and they'll gather here (synced with desktop Obsidian).
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
