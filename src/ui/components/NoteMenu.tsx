import { useState } from 'react';
import { flushActiveEditor } from '@/lib/editorFlush';
import { dirname, noteTitle } from '@/lib/paths';
import { useVault, vaultService } from '@/services';
import { useNav } from '@/state/nav';
import { useAnchoredMenu, type AnchorPoint } from '@/ui/hooks/useAnchoredMenu';
import {
  IconCopy,
  IconGraph,
  IconHistory,
  IconList,
  IconMove,
  IconNote,
  IconRename,
  IconSplit,
  IconStar,
  IconTrash,
  IconWikilink,
} from '@/ui/icons';
import { Dialog } from './Dialog';
import { FolderPicker } from './FolderPicker';
import { NoteInfoSheet } from './NoteInfoSheet';

type Mode = 'menu' | 'rename' | 'delete' | 'move' | 'info';

/**
 * The note ⋮ menu (top-right), Obsidian-style. Its trigger button
 * (`aria-label="Note menu"`) lives in NoteScreen/EditScreen, which this
 * component doesn't own and can't edit — so instead of a passed-in ref, it
 * measures that button's own DOM rect once on mount (it's already rendered:
 * clicking it doesn't unmount it, and only one screen is ever mounted at a
 * time, so the lookup is unambiguous). On desktop this anchors a compact
 * context menu below-right of the trigger; touch/mobile ignores the
 * measurement and keeps the bottom sheet.
 */
export function NoteMenu({ path, onClose }: { path: string; onClose: () => void }) {
  const nav = useNav();
  const desktop = useNav((s) => s.desktop);
  const [mode, setMode] = useState<Mode>('menu');
  const [infoTab, setInfoTab] = useState<'outline' | 'backlinks' | 'properties'>('outline');
  const bookmarks = useVault((s) => s.bookmarks);
  const bookmarked = bookmarks.includes(path);
  const [anchor] = useState<AnchorPoint | null>(() => {
    const trigger = document.querySelector<HTMLElement>('[aria-label="Note menu"]');
    if (!trigger) return null;
    const r = trigger.getBoundingClientRect();
    return { x: r.right, y: r.bottom + 6 };
  });
  const isCtxMenu = mode === 'menu' && desktop && !!anchor;
  const { ref, style } = useAnchoredMenu({
    anchor: isCtxMenu && anchor ? anchor : null,
    onClose,
    align: 'end',
  });

  if (mode === 'info') {
    return <NoteInfoSheet path={path} initialTab={infoTab} onClose={onClose} />;
  }

  if (mode === 'rename') {
    return (
      <Dialog
        title="Rename note"
        initialValue={noteTitle(path)}
        confirmLabel="Rename"
        onCancel={onClose}
        onConfirm={async (name) => {
          onClose();
          // Safe rename: sanitize/dedupe, vault-wide wikilink rewrite, bookmark
          // migration — then repoint every tab's history to the final path.
          await flushActiveEditor();
          const finalPath = await vaultService.renameByTitle(path, name);
          if (finalPath !== path) nav.renamePath(path, finalPath);
        }}
      />
    );
  }

  if (mode === 'move') {
    return (
      <FolderPicker
        title={`Move "${noteTitle(path)}" to…`}
        onClose={onClose}
        onPick={async (folder) => {
          onClose();
          // Safe move: dedupe + folder-qualified inbound link rewrite + bookmark
          // migration; renamePath keeps other tabs pointed at the note.
          await flushActiveEditor();
          const finalPath = await vaultService.moveFile(path, folder);
          if (finalPath !== path) nav.renamePath(path, finalPath);
        }}
      />
    );
  }

  if (mode === 'delete') {
    return (
      <Dialog
        title="Delete note?"
        message={`"${noteTitle(path)}" will be deleted from the vault. Git history still has it.`}
        confirmLabel="Delete"
        danger
        onCancel={onClose}
        onConfirm={async () => {
          onClose();
          await vaultService.deleteFile(path);
          nav.back();
        }}
      />
    );
  }

  const item = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    danger = false,
  ) => (
    <button
      className={danger ? 'sheet__item sheet__item--danger' : 'sheet__item'}
      onClick={onClick}
    >
      <span className="row__icon">{icon}</span>
      {label}
    </button>
  );

  const rows = (
    <>
      {/* Desktop-only (the split pane is desktop chrome; mobile sheet unchanged). */}
      {desktop &&
        item(<IconSplit size={19} />, 'Open to the right', () => {
          onClose();
          nav.openToTheRight(path);
        })}
      {item(
        <IconStar size={19} fill={bookmarked ? 'currentColor' : 'none'} />,
        bookmarked ? 'Remove bookmark' : 'Bookmark',
        () => {
          void vaultService.toggleBookmark(path);
          onClose();
        },
      )}
      {item(<IconList size={19} />, 'Outline', () => {
        setInfoTab('outline');
        setMode('info');
      })}
      {item(<IconWikilink size={19} />, 'Backlinks', () => {
        setInfoTab('backlinks');
        setMode('info');
      })}
      {item(<IconNote size={19} />, 'Properties', () => {
        setInfoTab('properties');
        setMode('info');
      })}
      {item(<IconGraph size={19} />, 'Local graph', () => {
        onClose();
        nav.push({ name: 'graph', path });
      })}
      {item(<IconHistory size={19} />, 'Version history', () => {
        onClose();
        nav.push({ name: 'history', path });
      })}
      {item(<IconRename size={19} />, 'Rename', () => setMode('rename'))}
      {item(<IconMove size={19} />, 'Move to folder…', () => setMode('move'))}
      {item(<IconCopy size={19} />, 'Duplicate', async () => {
        onClose();
        const text = await vaultService.readNote(path);
        const copy = await vaultService.createNote(dirname(path), `${noteTitle(path)} copy`);
        await vaultService.writeNote(copy, text);
        nav.push({ name: 'note', path: copy });
      })}
      {item(<IconTrash size={19} />, 'Delete', () => setMode('delete'), true)}
    </>
  );

  if (isCtxMenu) {
    return (
      <div ref={ref} className="ctx-menu" role="menu" aria-label="Note actions" style={style}>
        {rows}
      </div>
    );
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
        <div className="sheet__grab" />
        <p className="sheet__title">{noteTitle(path)}</p>
        {rows}
      </div>
    </>
  );
}
