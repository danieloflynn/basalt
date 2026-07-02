import { useState } from 'react';
import { basename, dirname, joinPath, noteTitle } from '@/lib/paths';
import { useVault, vaultService } from '@/services';
import { useNav } from '@/state/nav';
import {
  IconCopy,
  IconGraph,
  IconHistory,
  IconList,
  IconMove,
  IconNote,
  IconRename,
  IconStar,
  IconTrash,
  IconWikilink,
} from '@/ui/icons';
import { Dialog } from './Dialog';
import { FolderPicker } from './FolderPicker';
import { NoteInfoSheet } from './NoteInfoSheet';

type Mode = 'menu' | 'rename' | 'delete' | 'move' | 'info';

/** The note ⋮ menu (top-right), Obsidian-style. */
export function NoteMenu({ path, onClose }: { path: string; onClose: () => void }) {
  const nav = useNav();
  const [mode, setMode] = useState<Mode>('menu');
  const [infoTab, setInfoTab] = useState<'outline' | 'backlinks' | 'properties'>('outline');
  const bookmarks = useVault((s) => s.bookmarks);
  const bookmarked = bookmarks.includes(path);

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
          const clean = name.trim().replace(/[\\/:]/g, '-');
          onClose();
          if (clean && clean !== noteTitle(path)) {
            const to = joinPath(dirname(path), `${clean}.md`);
            await vaultService.renameFile(path, to);
            nav.replace({ name: 'note', path: to });
          }
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
          const to = joinPath(folder, basename(path));
          onClose();
          if (to !== path) {
            await vaultService.renameFile(path, to);
            nav.replace({ name: 'note', path: to });
          }
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

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
        <div className="sheet__grab" />
        <p className="sheet__title">{noteTitle(path)}</p>
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
      </div>
    </>
  );
}
