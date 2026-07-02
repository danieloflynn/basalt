import { basename, dirname, isMarkdownPath, normalizePath, stripExt } from './paths';

export interface WikiLink {
  /** Full source text including brackets (and ! for embeds). */
  raw: string;
  /** Link target with heading/block/alias stripped, e.g. 'Projects/Basalt'. */
  target: string;
  heading?: string;
  blockRef?: string;
  alias?: string;
  embed: boolean;
  start: number;
  end: number;
}

const WIKILINK_PATTERN = /(!)?\[\[([^\[\]]+?)\]\]/g;

/** Parse all [[wikilinks]] and ![[embeds]] in a chunk of markdown text. */
export function parseWikilinks(text: string): WikiLink[] {
  const links: WikiLink[] = [];
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const inner = match[2];
    const pipe = inner.indexOf('|');
    const targetPart = pipe === -1 ? inner : inner.slice(0, pipe);
    const alias = pipe === -1 ? undefined : inner.slice(pipe + 1).trim();

    let target = targetPart;
    let heading: string | undefined;
    let blockRef: string | undefined;
    const hash = targetPart.indexOf('#');
    if (hash !== -1) {
      target = targetPart.slice(0, hash);
      const ref = targetPart.slice(hash + 1);
      if (ref.startsWith('^')) blockRef = ref.slice(1);
      else heading = ref;
    }

    links.push({
      raw: match[0],
      target: target.trim(),
      heading: heading?.trim() || undefined,
      blockRef: blockRef?.trim() || undefined,
      alias: alias || undefined,
      embed: match[1] === '!',
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return links;
}

/** Split the inner text of a wikilink the same way parseWikilinks does. */
export function parseWikilinkInner(inner: string): Omit<WikiLink, 'raw' | 'start' | 'end' | 'embed'> {
  const [only] = parseWikilinks(`[[${inner}]]`);
  return { target: only.target, heading: only.heading, blockRef: only.blockRef, alias: only.alias };
}

/** Text shown for a link when no alias is given. */
export function wikilinkDisplayText(link: Pick<WikiLink, 'target' | 'heading' | 'alias'>): string {
  if (link.alias) return link.alias;
  const base = link.target ? stripExt(basename(link.target)) : '';
  if (link.heading) return base ? `${base} > ${link.heading}` : link.heading;
  return base;
}

/**
 * Resolves wikilink targets against the set of vault files using Obsidian's
 * rules: exact vault path first, then unique-basename lookup; ambiguous bare
 * names resolve to the file closest to the linking note.
 */
export class LinkResolver {
  private byLowerPath = new Map<string, string>();
  private mdByLowerBase = new Map<string, string[]>();
  private filesByLowerBase = new Map<string, string[]>();

  constructor(paths: Iterable<string>) {
    for (const p of paths) this.add(p);
  }

  add(path: string): void {
    this.byLowerPath.set(path.toLowerCase(), path);
    const base = basename(path).toLowerCase();
    push(this.filesByLowerBase, base, path);
    if (isMarkdownPath(path)) {
      push(this.mdByLowerBase, stripExt(base), path);
    }
  }

  remove(path: string): void {
    this.byLowerPath.delete(path.toLowerCase());
    const base = basename(path).toLowerCase();
    pull(this.filesByLowerBase, base, path);
    if (isMarkdownPath(path)) pull(this.mdByLowerBase, stripExt(base), path);
  }

  /**
   * Resolve a link target (as written between [[ ]]) from a source note.
   * Returns the vault path of the destination file, or null if it does not
   * exist (an "unresolved" link — a candidate for note creation).
   */
  resolve(target: string, fromPath: string): string | null {
    const cleaned = normalizePath(target.trim());
    if (!cleaned) return null;
    const lower = cleaned.toLowerCase();

    // 1. Path-style targets: vault-absolute, with and without .md.
    const absolute =
      this.byLowerPath.get(lower) ?? this.byLowerPath.get(`${lower}.md`);
    if (absolute) return absolute;

    // 2. Relative to the linking note's folder.
    const dir = dirname(fromPath);
    if (dir) {
      const rel = `${dir.toLowerCase()}/${lower}`;
      const relative = this.byLowerPath.get(rel) ?? this.byLowerPath.get(`${rel}.md`);
      if (relative) return relative;
    }

    // 3. Bare-name lookup (only meaningful when no folder is specified).
    if (!cleaned.includes('/')) {
      const candidates = /\.[a-z0-9]+$/i.test(cleaned)
        ? this.filesByLowerBase.get(lower)
        : this.mdByLowerBase.get(lower);
      if (candidates?.length) return closestTo(candidates, fromPath);
    }

    return null;
  }
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function pull(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (!list) return;
  const next = list.filter((v) => v !== value);
  if (next.length) map.set(key, next);
  else map.delete(key);
}

/** Of several candidates, pick the one sharing the longest folder prefix with `fromPath` (ties: shallowest, then alphabetical). */
function closestTo(candidates: string[], fromPath: string): string {
  const fromParts = dirname(fromPath).split('/').filter(Boolean);
  let best = candidates[0];
  let bestShared = -1;
  let bestDepth = Infinity;
  for (const c of [...candidates].sort()) {
    const parts = dirname(c).split('/').filter(Boolean);
    let shared = 0;
    while (shared < parts.length && shared < fromParts.length && parts[shared] === fromParts[shared]) {
      shared++;
    }
    if (shared > bestShared || (shared === bestShared && parts.length < bestDepth)) {
      best = c;
      bestShared = shared;
      bestDepth = parts.length;
    }
  }
  return best;
}
