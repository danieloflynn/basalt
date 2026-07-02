/**
 * Vault paths are always vault-relative, use forward slashes, and never
 * start or end with '/'. The vault root is ''.
 */

export function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const part of p.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

export function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

export function extname(p: string): string {
  const name = basename(p);
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i).toLowerCase();
}

export function stripExt(p: string): string {
  const ext = extname(p);
  return ext ? p.slice(0, -ext.length) : p;
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'));
}

export function isMarkdownPath(p: string): boolean {
  return extname(p) === '.md';
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp']);

export function isImagePath(p: string): boolean {
  return IMAGE_EXTS.has(extname(p));
}

/** Display title of a note: its basename without the .md extension. */
export function noteTitle(p: string): string {
  return stripExt(basename(p));
}

/** True for paths that should be hidden from browsing (.git, .obsidian, .trash …). */
export function isHiddenPath(p: string): boolean {
  return p.split('/').some((part) => part.startsWith('.'));
}
