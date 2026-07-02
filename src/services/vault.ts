import MiniSearch from 'minisearch';
import { create } from 'zustand';
import { getVaultFS, type VaultFileInfo } from '@/engine';
import { parseFrontmatter } from '@/lib/frontmatter';
import { extractTags } from '@/lib/tags';
import { buildTree, type TreeFolder } from '@/lib/tree';
import { isHiddenPath, isMarkdownPath, joinPath, noteTitle } from '@/lib/paths';
import { LinkResolver } from '@/lib/wikilinks';

export interface NoteMeta {
  path: string;
  title: string;
  tags: string[];
  mtimeMs: number;
}

export interface SearchHit {
  path: string;
  title: string;
  /** Short content excerpt around the first match, if any. */
  excerpt: string | null;
  score: number;
}

interface VaultState {
  ready: boolean;
  files: VaultFileInfo[];
  tree: TreeFolder;
  notes: Map<string, NoteMeta>;
  recents: string[];
  indexVersion: number;
}

export const useVault = create<VaultState>(() => ({
  ready: false,
  files: [],
  tree: buildTree([]),
  notes: new Map(),
  recents: [],
  indexVersion: 0,
}));

const EXCERPT_RADIUS = 60;

/**
 * Owns everything derived from the files on disk: folder tree, note metadata,
 * wikilink resolver, and the full-text index. All of it is a cache — the
 * files remain the source of truth (TD-22).
 */
export class VaultService {
  private fs = getVaultFS();
  private resolver = new LinkResolver([]);
  private contents = new Map<string, string>();
  private search = this.newSearchIndex();
  /** Called after any local content change; wired to SyncService in services/index.ts. */
  onEdited: () => void = () => {};

  private newSearchIndex(): MiniSearch {
    return new MiniSearch({
      fields: ['title', 'content', 'tags'],
      storeFields: ['title'],
      idField: 'path',
      searchOptions: {
        boost: { title: 4, tags: 2 },
        prefix: true,
        fuzzy: 0.15,
      },
    });
  }

  /** Full (re)build from disk — startup and after sync pulls remote changes. */
  async initialize(): Promise<void> {
    const files = await this.fs.list();
    const mdPaths = files.map((f) => f.path).filter((p) => isMarkdownPath(p) && !isHiddenPath(p));
    const contents = await this.fs.readMany(mdPaths);

    this.resolver = new LinkResolver(files.map((f) => f.path).filter((p) => !isHiddenPath(p)));
    this.contents = new Map(Object.entries(contents));
    this.search = this.newSearchIndex();

    const notes = new Map<string, NoteMeta>();
    const docs: object[] = [];
    for (const file of files) {
      if (!isMarkdownPath(file.path) || isHiddenPath(file.path)) continue;
      const text = contents[file.path] ?? '';
      const meta = this.noteMeta(file.path, text, file.mtimeMs);
      notes.set(file.path, meta);
      docs.push(this.searchDoc(meta, text));
    }
    this.search.addAll(docs);

    useVault.setState((s) => ({
      ready: true,
      files,
      tree: buildTree(files.map((f) => f.path)),
      notes,
      indexVersion: s.indexVersion + 1,
    }));
  }

  private noteMeta(path: string, text: string, mtimeMs: number): NoteMeta {
    return { path, title: noteTitle(path), tags: extractTags(text), mtimeMs };
  }

  private searchDoc(meta: NoteMeta, text: string): object {
    return {
      path: meta.path,
      title: meta.title,
      content: parseFrontmatter(text).body,
      tags: meta.tags.join(' '),
    };
  }

  // ------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------

  async readNote(path: string): Promise<string> {
    const cached = this.contents.get(path);
    const text = cached ?? (await this.fs.read(path));
    this.contents.set(path, text);
    this.touchRecents(path);
    return text;
  }

  fileUrl(path: string): Promise<string> {
    return this.fs.fileUrl(path);
  }

  resolveLink(target: string, fromPath: string): string | null {
    return this.resolver.resolve(target, fromPath);
  }

  noteContent(path: string): string | undefined {
    return this.contents.get(path);
  }

  private touchRecents(path: string): void {
    useVault.setState((s) => ({
      recents: [path, ...s.recents.filter((p) => p !== path)].slice(0, 20),
    }));
  }

  // ------------------------------------------------------------------
  // Writing / file management
  // ------------------------------------------------------------------

  async writeNote(path: string, text: string): Promise<void> {
    await this.fs.write(path, text);
    this.contents.set(path, text);
    const meta = this.noteMeta(path, text, Date.now());
    const known = useVault.getState().notes.has(path);
    if (known) this.search.replace(this.searchDoc(meta, text));
    else this.search.add(this.searchDoc(meta, text));
    useVault.setState((s) => {
      const notes = new Map(s.notes).set(path, meta);
      return { notes, indexVersion: s.indexVersion + 1 };
    });
    this.onEdited();
  }

  /** Create a new empty note; returns the path actually used (deduped). */
  async createNote(folder: string, name?: string): Promise<string> {
    const base = (name ?? 'Untitled').replace(/[\\/:]/g, '-').replace(/\.md$/i, '');
    let candidate = joinPath(folder, `${base}.md`);
    let n = 2;
    const { notes } = useVault.getState();
    while (notes.has(candidate)) {
      candidate = joinPath(folder, `${base} ${n}.md`);
      n++;
    }
    await this.fs.write(candidate, '');
    this.resolver.add(candidate);
    await this.afterStructuralChange();
    return candidate;
  }

  async deleteFile(path: string): Promise<void> {
    await this.fs.remove(path);
    this.contents.delete(path);
    this.resolver.remove(path);
    if (useVault.getState().notes.has(path)) {
      this.search.discard(path);
    }
    useVault.setState((s) => ({ recents: s.recents.filter((p) => p !== path) }));
    await this.afterStructuralChange();
  }

  async renameFile(from: string, to: string): Promise<void> {
    await this.fs.rename(from, to);
    const text = this.contents.get(from);
    this.contents.delete(from);
    this.resolver.remove(from);
    this.resolver.add(to);
    if (text !== undefined) this.contents.set(to, text);
    if (isMarkdownPath(from)) this.search.discard(from);
    if (isMarkdownPath(to)) {
      const t = text ?? (await this.fs.read(to));
      this.search.add(this.searchDoc(this.noteMeta(to, t, Date.now()), t));
    }
    useVault.setState((s) => ({
      recents: s.recents.map((p) => (p === from ? to : p)),
    }));
    await this.afterStructuralChange();
  }

  async createFolder(path: string): Promise<void> {
    // Git doesn't track empty dirs — drop a .gitkeep so the folder syncs.
    await this.fs.mkdir(path);
    await this.fs.write(joinPath(path, '.gitkeep'), '');
    await this.afterStructuralChange();
  }

  async deleteFolder(path: string): Promise<void> {
    await this.fs.rmdir(path);
    const prefix = `${path}/`;
    for (const p of [...this.contents.keys()]) {
      if (p.startsWith(prefix)) {
        this.contents.delete(p);
        this.resolver.remove(p);
        if (isMarkdownPath(p)) this.search.discard(p);
      }
    }
    await this.afterStructuralChange();
  }

  async saveAttachment(folder: string, fileName: string, base64: string): Promise<string> {
    let candidate = joinPath(folder, fileName);
    let n = 2;
    const existing = new Set(useVault.getState().files.map((f) => f.path));
    while (existing.has(candidate)) {
      const dot = fileName.lastIndexOf('.');
      const stem = dot === -1 ? fileName : fileName.slice(0, dot);
      const ext = dot === -1 ? '' : fileName.slice(dot);
      candidate = joinPath(folder, `${stem} ${n}${ext}`);
      n++;
    }
    await this.fs.writeBinary(candidate, base64);
    this.resolver.add(candidate);
    await this.afterStructuralChange();
    return candidate;
  }

  /** Re-list files and rebuild the tree after create/rename/delete, then queue a sync. */
  private async afterStructuralChange(): Promise<void> {
    const files = await this.fs.list();
    useVault.setState((s) => ({
      files,
      tree: buildTree(files.map((f) => f.path)),
      notes: this.rebuildNotesMeta(files, s.notes),
      indexVersion: s.indexVersion + 1,
    }));
    this.onEdited();
  }

  private rebuildNotesMeta(
    files: VaultFileInfo[],
    previous: Map<string, NoteMeta>,
  ): Map<string, NoteMeta> {
    const notes = new Map<string, NoteMeta>();
    for (const f of files) {
      if (!isMarkdownPath(f.path) || isHiddenPath(f.path)) continue;
      const text = this.contents.get(f.path);
      notes.set(
        f.path,
        text !== undefined
          ? this.noteMeta(f.path, text, f.mtimeMs)
          : (previous.get(f.path) ?? { path: f.path, title: noteTitle(f.path), tags: [], mtimeMs: f.mtimeMs }),
      );
    }
    return notes;
  }

  // ------------------------------------------------------------------
  // Search (SE-1..4)
  // ------------------------------------------------------------------

  searchNotes(query: string, limit = 30): SearchHit[] {
    const q = query.trim();
    if (!q) return [];
    return this.search.search(q).slice(0, limit).map((r) => ({
      path: String(r.id),
      title: (r as unknown as { title: string }).title,
      excerpt: this.excerptFor(String(r.id), q),
      score: r.score,
    }));
  }

  /** Title-only matches for the quick-open switcher (SE-3). */
  quickOpen(query: string, limit = 12): NoteMeta[] {
    const q = query.trim().toLowerCase();
    const notes = [...useVault.getState().notes.values()];
    if (!q) {
      const { recents } = useVault.getState();
      const byRecent = recents
        .map((p) => useVault.getState().notes.get(p))
        .filter((n): n is NoteMeta => Boolean(n));
      const rest = notes
        .filter((n) => !recents.includes(n.path))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      return [...byRecent, ...rest].slice(0, limit);
    }
    const scored = notes
      .map((n) => ({ n, s: fuzzyScore(n.title.toLowerCase(), q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    return scored.slice(0, limit).map((x) => x.n);
  }

  notesWithTag(tag: string): NoteMeta[] {
    const lower = tag.toLowerCase();
    return [...useVault.getState().notes.values()]
      .filter((n) => n.tags.some((t) => t.toLowerCase() === lower))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Note titles for wikilink autocomplete (E-7). */
  linkTargets(): NoteMeta[] {
    return [...useVault.getState().notes.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  private excerptFor(path: string, query: string): string | null {
    const text = this.contents.get(path);
    if (!text) return null;
    const body = parseFrontmatter(text).body;
    const firstTerm = query.split(/\s+/)[0]?.toLowerCase() ?? '';
    const at = body.toLowerCase().indexOf(firstTerm);
    if (at === -1) return body.slice(0, EXCERPT_RADIUS * 2).replace(/\s+/g, ' ').trim() || null;
    const start = Math.max(0, at - EXCERPT_RADIUS);
    const end = Math.min(body.length, at + firstTerm.length + EXCERPT_RADIUS);
    return `${start > 0 ? '…' : ''}${body.slice(start, end).replace(/\s+/g, ' ').trim()}${end < body.length ? '…' : ''}`;
  }
}

/** Simple subsequence scorer: rewards matches at word starts and contiguity. */
function fuzzyScore(text: string, query: string): number {
  if (text.includes(query)) return 100 - text.indexOf(query) - (text.length - query.length) * 0.1;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of query) {
    const found = text.indexOf(ch, ti);
    if (found === -1) return 0;
    streak = found === ti ? streak + 1 : 1;
    score += streak + (found === 0 || text[found - 1] === ' ' ? 3 : 0);
    ti = found + 1;
  }
  return score;
}

export const vaultService = new VaultService();
