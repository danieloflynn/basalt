import { useVault } from '@/services';
import type { TreeNode } from '@/lib/tree';
import { IconFolder } from '@/ui/icons';

/** Bottom-sheet folder chooser (move-to-folder, F-2). */
export function FolderPicker({
  title,
  onPick,
  onClose,
}: {
  title: string;
  onPick: (folder: string) => void;
  onClose: () => void;
}) {
  const tree = useVault((s) => s.tree);
  const folders: { path: string; depth: number }[] = [{ path: '', depth: 0 }];
  collect(tree, 0, folders);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        <div className="sheet__grab" />
        <p className="sheet__title">{title}</p>
        {folders.map((f) => (
          <button
            key={f.path || '/'}
            className="sheet__item"
            style={{ paddingLeft: 14 + f.depth * 18 }}
            onClick={() => onPick(f.path)}
          >
            <span className="row__icon">
              <IconFolder size={18} />
            </span>
            {f.path === '' ? 'Vault root' : f.path.split('/').pop()}
          </button>
        ))}
      </div>
    </>
  );
}

function collect(node: TreeNode, depth: number, out: { path: string; depth: number }[]): void {
  if (node.kind !== 'folder') return;
  for (const child of node.children) {
    if (child.kind === 'folder') {
      out.push({ path: child.path, depth: depth + 1 });
      collect(child, depth + 1, out);
    }
  }
}
