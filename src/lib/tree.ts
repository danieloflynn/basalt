import { basename, isHiddenPath } from './paths';

export interface TreeFile {
  kind: 'file';
  name: string;
  path: string;
}

export interface TreeFolder {
  kind: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
}

export type TreeNode = TreeFile | TreeFolder;

/** Build a sorted folder tree (folders first, case-insensitive alpha) from vault-relative paths. */
export function buildTree(paths: Iterable<string>): TreeFolder {
  const root: TreeFolder = { kind: 'folder', name: '', path: '', children: [] };
  const folders = new Map<string, TreeFolder>([['', root]]);

  const ensureFolder = (path: string): TreeFolder => {
    const existing = folders.get(path);
    if (existing) return existing;
    const parent = ensureFolder(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
    const folder: TreeFolder = { kind: 'folder', name: basename(path), path, children: [] };
    folders.set(path, folder);
    parent.children.push(folder);
    return folder;
  };

  for (const path of paths) {
    if (isHiddenPath(path)) continue;
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    ensureFolder(dir).children.push({ kind: 'file', name: basename(path), path });
  }

  for (const folder of folders.values()) sortChildren(folder);
  return root;
}

function sortChildren(folder: TreeFolder): void {
  folder.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
}

export function* walkFiles(node: TreeNode): Generator<TreeFile> {
  if (node.kind === 'file') {
    yield node;
    return;
  }
  for (const child of node.children) yield* walkFiles(child);
}
