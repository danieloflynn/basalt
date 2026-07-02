import { useMemo, useRef, useState } from 'react';
import type { TouchEvent } from 'react';
import { basename, noteTitle } from '@/lib/paths';
import type { TreeFolder, TreeNode } from '@/lib/tree';
import { syncService, useSync, useVault, vaultService } from '@/services';
import { openNote, useNav } from '@/state/nav';
import {
  IconChevronRight,
  IconClock,
  IconFolder,
  IconFolderPlus,
  IconNote,
  IconNotePlus,
  IconPlus,
  IconSearch,
  IconSettings,
} from '@/ui/icons';
import { FileActionsSheet } from '@/ui/components/FileActionsSheet';
import { Dialog } from '@/ui/components/Dialog';
import { SyncStatus } from '@/ui/components/SyncStatus';
import { Banners } from '@/ui/components/Banners';

const LONG_PRESS_MS = 450;

export function BrowserScreen({ folder }: { folder: string }) {
  const nav = useNav();
  const { tree, notes, recents, ready } = useVault();
  const syncPhase = useSync((s) => s.phase);
  const [actionTarget, setActionTarget] = useState<TreeNode | null>(null);
  const [creating, setCreating] = useState<'note' | 'folder' | null>(null);
  const [fabOpen, setFabOpen] = useState(false);

  const node = useMemo(() => findFolder(tree, folder), [tree, folder]);
  const isRoot = folder === '';

  // Pull-to-refresh (SY-8)
  const touchStartY = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pulling, setPulling] = useState(false);

  const onTouchStart = (e: TouchEvent) => {
    if (scrollRef.current && scrollRef.current.scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY;
    } else {
      touchStartY.current = null;
    }
  };
  const onTouchMove = (e: TouchEvent) => {
    if (touchStartY.current === null) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    setPulling(dy > 70);
  };
  const onTouchEnd = () => {
    if (pulling && syncPhase !== 'pulling' && syncPhase !== 'pushing') {
      void syncService.syncNow('pull-to-refresh');
    }
    setPulling(false);
    touchStartY.current = null;
  };

  const recentNotes = useMemo(
    () =>
      isRoot
        ? recents
            .map((p) => notes.get(p))
            .filter((n): n is NonNullable<typeof n> => Boolean(n))
            .slice(0, 3)
        : [],
    [isRoot, recents, notes],
  );

  return (
    <div className="shell">
      <div className="screen">
        <header className="topbar">
          {!isRoot && (
            <button className="iconbtn" aria-label="Back" onClick={() => nav.back()}>
              <IconChevronRight style={{ transform: 'rotate(180deg)' }} />
            </button>
          )}
          <h1 className="topbar__title">
            {isRoot ? 'Basalt' : basename(folder)}
            {isRoot && <SyncStatus.Subtitle />}
          </h1>
          <SyncStatus />
          <button
            className="iconbtn"
            aria-label="Search"
            onClick={() => nav.push({ name: 'search' })}
          >
            <IconSearch />
          </button>
          {isRoot && (
            <button
              className="iconbtn"
              aria-label="Settings"
              onClick={() => nav.push({ name: 'settings' })}
            >
              <IconSettings />
            </button>
          )}
        </header>

        <Banners />

        <div
          className="scroll"
          ref={scrollRef}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {pulling && (
            <p style={{ textAlign: 'center', padding: 10, color: 'var(--text-faint)', fontSize: 'var(--text-sm)' }}>
              Release to sync
            </p>
          )}

          {recentNotes.length > 0 && (
            <div className="rowlist" style={{ paddingBottom: 0 }}>
              <p className="group__label" style={{ padding: '8px 12px 4px' }}>
                Recent
              </p>
              {recentNotes.map((n) => (
                <button key={n.path} className="row" onClick={() => openNote(n.path)}>
                  <span className="row__icon">
                    <IconClock size={19} />
                  </span>
                  <span className="row__body">
                    <span className="row__title" style={{ display: 'block' }}>
                      {n.title}
                    </span>
                  </span>
                </button>
              ))}
              <p className="group__label" style={{ padding: '14px 12px 0' }}>
                Vault
              </p>
            </div>
          )}

          {!ready && <div className="state" />}

          {ready && node && node.children.length === 0 && (
            <div className="state">
              <div className="columns-hero" aria-hidden="true">
                <div className="col" />
                <div className="col" />
                <div className="col" />
                <div className="col" />
                <div className="col" />
              </div>
              <p className="state__title">{isRoot ? 'An empty vault' : 'An empty folder'}</p>
              <p className="state__hint">
                Notes you create here sync to your repository. Tap + to write the first one.
              </p>
            </div>
          )}

          {ready && node && node.children.length > 0 && (
            <FileRows
              nodes={node.children}
              onLongPress={setActionTarget}
              onOpenFolder={(p) => nav.push({ name: 'browser', folder: p })}
            />
          )}
        </div>

        {fabOpen && (
          <>
            <div className="scrim" onClick={() => setFabOpen(false)} />
            <div className="sheet">
              <div className="sheet__grab" />
              <button
                className="sheet__item"
                onClick={() => {
                  setFabOpen(false);
                  setCreating('note');
                }}
              >
                <span className="row__icon">
                  <IconNotePlus />
                </span>
                New note
              </button>
              <button
                className="sheet__item"
                onClick={() => {
                  setFabOpen(false);
                  setCreating('folder');
                }}
              >
                <span className="row__icon">
                  <IconFolderPlus />
                </span>
                New folder
              </button>
            </div>
          </>
        )}

        <button className="fab" aria-label="Create" onClick={() => setFabOpen(true)}>
          <IconPlus size={26} />
        </button>

        {actionTarget && (
          <FileActionsSheet node={actionTarget} onClose={() => setActionTarget(null)} />
        )}

        {creating && (
          <Dialog
            title={creating === 'note' ? 'New note' : 'New folder'}
            placeholder={creating === 'note' ? 'Note name' : 'Folder name'}
            confirmLabel="Create"
            onCancel={() => setCreating(null)}
            onConfirm={async (name) => {
              const kind = creating;
              setCreating(null);
              if (!name.trim()) return;
              if (kind === 'note') {
                const path = await vaultService.createNote(folder, name.trim());
                nav.push({ name: 'edit', path });
              } else {
                await vaultService.createFolder(
                  folder ? `${folder}/${name.trim()}` : name.trim(),
                );
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function FileRows({
  nodes,
  onLongPress,
  onOpenFolder,
}: {
  nodes: TreeNode[];
  onLongPress: (n: TreeNode) => void;
  onOpenFolder: (path: string) => void;
}) {
  return (
    <div className="rowlist">
      {nodes.map((n) => (
        <FileRow key={n.path} node={n} onLongPress={onLongPress} onOpenFolder={onOpenFolder} />
      ))}
    </div>
  );
}

function FileRow({
  node,
  onLongPress,
  onOpenFolder,
}: {
  node: TreeNode;
  onLongPress: (n: TreeNode) => void;
  onOpenFolder: (path: string) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  const start = () => {
    fired.current = false;
    timer.current = setTimeout(() => {
      fired.current = true;
      onLongPress(node);
    }, LONG_PRESS_MS);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const isFolder = node.kind === 'folder';
  const fileCount = isFolder ? node.children.length : 0;

  return (
    <button
      className="row"
      onTouchStart={start}
      onTouchMove={cancel}
      onTouchEnd={cancel}
      onContextMenu={(e) => {
        e.preventDefault();
        onLongPress(node);
      }}
      onClick={() => {
        if (fired.current) return;
        if (isFolder) onOpenFolder(node.path);
        else if (node.path.toLowerCase().endsWith('.md')) openNote(node.path);
      }}
    >
      <span className={isFolder ? 'row__icon row__icon--folder' : 'row__icon'}>
        {isFolder ? <IconFolder size={20} /> : <IconNote size={20} />}
      </span>
      <span className="row__body">
        <span className="row__title" style={{ display: 'block' }}>
          {isFolder ? node.name : noteTitle(node.path)}
        </span>
        {isFolder && (
          <span className="row__meta" style={{ display: 'block' }}>
            {fileCount} {fileCount === 1 ? 'item' : 'items'}
          </span>
        )}
      </span>
      {isFolder && (
        <span className="row__chevron">
          <IconChevronRight size={18} />
        </span>
      )}
    </button>
  );
}

function findFolder(tree: TreeFolder, path: string): TreeFolder | null {
  if (path === '') return tree;
  for (const child of tree.children) {
    if (child.kind !== 'folder') continue;
    if (child.path === path) return child;
    if (path.startsWith(`${child.path}/`)) return findFolder(child, path);
  }
  return null;
}
