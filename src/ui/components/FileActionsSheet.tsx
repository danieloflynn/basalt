import { useState } from 'react';
import { dirname, joinPath, noteTitle } from '@/lib/paths';
import type { TreeNode } from '@/lib/tree';
import { vaultService } from '@/services';
import { useNav } from '@/state/nav';
import { IconCopy, IconNotePlus, IconRename, IconTrash } from '@/ui/icons';
import { Dialog } from './Dialog';

/** Long-press actions on a file or folder: rename, duplicate, delete (F-2/F-4). */
export function FileActionsSheet({ node, onClose }: { node: TreeNode; onClose: () => void }) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'delete'>('menu');
  const isFolder = node.kind === 'folder';
  const displayName = isFolder ? node.name : noteTitle(node.path);

  if (mode === 'rename') {
    return (
      <Dialog
        title={isFolder ? 'Rename folder' : 'Rename note'}
        initialValue={displayName}
        confirmLabel="Rename"
        onCancel={onClose}
        onConfirm={async (name) => {
          const clean = name.trim().replace(/[\\/:]/g, '-');
          if (clean && clean !== displayName) {
            const dir = dirname(node.path);
            const to = isFolder ? joinPath(dir, clean) : joinPath(dir, `${clean}.md`);
            if (isFolder) {
              // Folder rename = rename every file under it (git-friendly).
              for (const f of collectPaths(node)) {
                await vaultService.renameFile(f, to + f.slice(node.path.length));
              }
            } else {
              await vaultService.renameFile(node.path, to);
            }
          }
          onClose();
        }}
      />
    );
  }

  if (mode === 'delete') {
    return (
      <Dialog
        title={`Delete ${isFolder ? 'folder' : 'note'}?`}
        message={
          isFolder
            ? `"${displayName}" and everything inside it will be deleted from the vault. Git history still has it until history is rewritten.`
            : `"${displayName}" will be deleted from the vault. Git history still has it.`
        }
        confirmLabel="Delete"
        danger
        onCancel={onClose}
        onConfirm={async () => {
          if (isFolder) await vaultService.deleteFolder(node.path);
          else await vaultService.deleteFile(node.path);
          onClose();
        }}
      />
    );
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <div className="sheet__grab" />
        <p className="sheet__title">{displayName}</p>
        {isFolder && (
          <button
            className="sheet__item"
            onClick={async () => {
              onClose(); // close first so a second tap can't create twice
              const path = await vaultService.createNote(node.path, 'Untitled');
              useNav.getState().push({ name: 'edit', path });
            }}
          >
            <span className="row__icon">
              <IconNotePlus size={20} />
            </span>
            New note
          </button>
        )}
        <button className="sheet__item" onClick={() => setMode('rename')}>
          <span className="row__icon">
            <IconRename size={20} />
          </span>
          Rename
        </button>
        {!isFolder && (
          <button
            className="sheet__item"
            onClick={async () => {
              const text = await vaultService.readNote(node.path);
              const copy = await vaultService.createNote(
                dirname(node.path),
                `${noteTitle(node.path)} copy`,
              );
              await vaultService.writeNote(copy, text);
              onClose();
            }}
          >
            <span className="row__icon">
              <IconCopy size={20} />
            </span>
            Duplicate
          </button>
        )}
        <button className="sheet__item sheet__item--danger" onClick={() => setMode('delete')}>
          <span className="row__icon">
            <IconTrash size={20} />
          </span>
          Delete
        </button>
      </div>
    </>
  );
}

function* collectPaths(node: TreeNode): Generator<string> {
  if (node.kind === 'file') {
    yield node.path;
    return;
  }
  for (const child of node.children) yield* collectPaths(child);
}
