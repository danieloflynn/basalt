import { useState } from 'react';
import { flushActiveEditor } from '@/lib/editorFlush';
import {
  dirname,
  extname,
  isMarkdownPath,
  joinPath,
  noteTitle,
  sanitizeNoteTitle,
} from '@/lib/paths';
import type { TreeNode } from '@/lib/tree';
import { vaultService } from '@/services';
import { useNav } from '@/state/nav';
import { IconCopy, IconNotePlus, IconRename, IconTrash } from '@/ui/icons';
import { Dialog } from './Dialog';

/** Long-press actions on a file or folder: rename, duplicate, delete (F-2/F-4). */
export function FileActionsSheet({ node, onClose }: { node: TreeNode; onClose: () => void }) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'delete'>('menu');
  const isFolder = node.kind === 'folder';
  const isNote = !isFolder && isMarkdownPath(node.path);
  const kind = isFolder ? 'folder' : isNote ? 'note' : 'file';
  const displayName = isFolder ? node.name : noteTitle(node.path);

  if (mode === 'rename') {
    return (
      <Dialog
        title={`Rename ${kind}`}
        initialValue={displayName}
        confirmLabel="Rename"
        onCancel={onClose}
        onConfirm={async (name) => {
          onClose();
          const clean = name.trim();
          if (!clean || clean === displayName) return;
          await flushActiveEditor();
          const nav = useNav.getState();
          if (isFolder) {
            // Safe folder rename (sibling dedupe, hidden files, inbound link
            // rewrite, bookmark migration); repoint history per moved file.
            const moves = await vaultService.renameFolder(node.path, clean);
            for (const { from, to } of moves) nav.renamePath(from, to);
          } else if (isNote) {
            // Safe note rename (sanitize/dedupe/link-rewrite/bookmark migration).
            const finalPath = await vaultService.renameByTitle(node.path, clean);
            if (finalPath !== node.path) nav.renamePath(node.path, finalPath);
          } else {
            // Other files (e.g. .html artifacts): renameByTitle is .md-only, so
            // rename in place keeping the extension. Guarded renameFile throws
            // rather than overwrite an existing file (never silently clobbers).
            const to = joinPath(dirname(node.path), sanitizeNoteTitle(clean) + extname(node.path));
            if (to !== node.path) {
              await vaultService.renameFile(node.path, to);
              nav.renamePath(node.path, to);
            }
          }
        }}
      />
    );
  }

  if (mode === 'delete') {
    return (
      <Dialog
        title={`Delete ${kind}?`}
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
        {/* Duplicate goes through createNote, which is markdown-only. */}
        {isNote && (
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
