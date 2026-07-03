import MiniSearch from 'minisearch';
import { create } from 'zustand';
import { getVaultFS, type VaultFileInfo } from '@/engine';
import { parseFrontmatter } from '@/lib/frontmatter';
import { extractOutline, type HeadingInfo } from '@/lib/outline';
import { extractTags, stripCode } from '@/lib/tags';
import { stripInlineMarkdown } from '@/lib/plaintext';
import { buildTree, type TreeFolder } from '@/lib/tree';
import { dirname, isHiddenPath, isMarkdownPath, joinPath, noteTitle } from '@/lib/paths';
import { LinkResolver, parseWikilinks } from '@/lib/wikilinks';
import { rewriteWikilinks } from '@/lib/wikilinkRewrite';

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

export interface Backlink {
  path: string;
  title: string;
  /** Source line(s) around the mention. */
  context: string;
}

interface VaultState {
  ready: boolean;
  files: VaultFileInfo[];
  tree: TreeFolder;
  notes: Map<string, NoteMeta>;
  recents: string[];
  bookmarks: string[];
  indexVersion: number;
}

export const useVault = create<VaultState>(() => ({
  ready: false,
  files: [],
  tree: buildTree([]),
  notes: new Map(),
  recents: [],
  bookmarks: [],
  indexVersion: 0,
}));

const BOOKMARKS_FILE = '.obsidian/bookmarks.json';

const EXCERPT_RADIUS = 60;

/**
 * Owns everything derived from the files on disk: folder tree, note metadata,
 * wikilink resolver, and the full-text index. All of it is a cache — the
 * files remain the source of truth (TD-22).
 */
export class VaultService {
  private resolver = new LinkResolver([]);
  private contents = new Map<string, string>();
  private search = this.newSearchIndex();
  /** Resolved outgoing links per note; backlinks are the inverse. */
  private outgoing = new Map<string, Set<string>>();
  private backlinks = new Map<string, Set<string>>();
  /** Called after any local content change; wired to SyncService in services/index.ts. */
  onEdited: () => void = () => {};

  /** Live accessor so vault switching (multi-vault) swaps the FS underneath us. */
  private get fs() {
    return getVaultFS();
  }

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
    this.rebuildLinkGraph();

    useVault.setState((s) => ({
      ready: true,
      files,
      tree: buildTree(files.map((f) => f.path)),
      notes,
      bookmarks: [],
      indexVersion: s.indexVersion + 1,
    }));
    await this.loadBookmarks();
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
    // Membership must come from the index itself — the notes map is rebuilt
    // from file listings and can say "known" for a doc the index never saw.
    if (this.search.has(path)) this.search.replace(this.searchDoc(meta, text));
    else this.search.add(this.searchDoc(meta, text));
    this.setOutgoing(path, text);
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
    this.contents.set(candidate, '');
    this.resolver.add(candidate);
    // Index now — every later search op (autosave replace, rename discard)
    // assumes markdown files are present in the index.
    this.search.add(this.searchDoc(this.noteMeta(candidate, '', Date.now()), ''));
    await this.afterStructuralChange();
    return candidate;
  }

  async deleteFile(path: string): Promise<void> {
    await this.fs.remove(path);
    this.contents.delete(path);
    this.resolver.remove(path);
    if (this.search.has(path)) {
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
    if (isMarkdownPath(from) && this.search.has(from)) this.search.discard(from);
    if (isMarkdownPath(to)) {
      const t = text ?? (await this.fs.read(to));
      this.search.add(this.searchDoc(this.noteMeta(to, t, Date.now()), t));
    }
    useVault.setState((s) => ({
      recents: s.recents.map((p) => (p === from ? to : p)),
    }));
    await this.afterStructuralChange();
  }

  /**
   * Rename a note from a user-typed title (the "inline title IS the filename"
   * model). Returns the path actually used — equal to `path` for a no-op.
   * Sanitizes/dedupes like createNote, rewrites inbound wikilinks so no link is
   * orphaned, and migrates note-path stores (recents via renameFile, bookmarks).
   */
  async renameByTitle(path: string, rawTitle: string): Promise<string> {
    const folder = dirname(path);
    const currentBase = noteTitle(path);
    // Same char policy as createNote (strip a typed .md, [\/:] -> '-'), trimmed.
    const base = rawTitle.trim().replace(/\.md$/i, '').replace(/[\\/:]/g, '-').trim();
    // No-op: nothing typed, or unchanged — no fs call, no sync queued.
    if (!base || base === currentBase) return path;

    // Dedupe against existing notes; Android's FS is case-insensitive, so
    // compare lowercased — but exclude ourselves so a deliberate case-only
    // rename (Foo -> foo) still goes through fs.rename.
    const taken = new Set(
      [...useVault.getState().notes.keys()].filter((p) => p !== path).map((p) => p.toLowerCase()),
    );
    let candidate = base;
    let n = 2;
    while (taken.has(joinPath(folder, `${candidate}.md`).toLowerCase())) {
      candidate = `${base} ${n}`;
      n++;
    }
    const to = joinPath(folder, `${candidate}.md`);
    if (to === path) return path;

    // Repoint links BEFORE the rename, while the resolver still knows the old
    // path (afterwards "Old" would no longer resolve to this note). writeNote
    // reindexes each source; the final rebuild in renameFile fixes the graph.
    const newBase = noteTitle(to);
    for (const [src, text] of this.contents) {
      if (!isMarkdownPath(src) || isHiddenPath(src)) continue;
      const rewritten = rewriteWikilinks(text, {
        newBase,
        shouldRewrite: (target) => this.resolver.resolve(target, src) === path,
      });
      if (rewritten !== text) await this.writeNote(src, rewritten);
    }

    await this.renameFile(path, to);
    await this.migrateBookmark(path, to);
    return to;
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
        if (isMarkdownPath(p) && this.search.has(p)) this.search.discard(p);
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
    this.rebuildLinkGraph();
    useVault.setState((s) => ({
      files,
      tree: buildTree(files.map((f) => f.path)),
      notes: this.rebuildNotesMeta(files, s.notes),
      indexVersion: s.indexVersion + 1,
    }));
    this.onEdited();
  }

  // ------------------------------------------------------------------
  // Link graph (backlinks, graph view)
  // ------------------------------------------------------------------

  private linksIn(path: string, text: string): Set<string> {
    const out = new Set<string>();
    const body = stripCode(parseFrontmatter(text).body);
    for (const link of parseWikilinks(body)) {
      const resolved = this.resolver.resolve(link.target, path);
      if (resolved && resolved !== path && isMarkdownPath(resolved)) out.add(resolved);
    }
    for (const m of body.matchAll(/(^|[^!])\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const href = m[2];
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      const resolved = this.resolver.resolve(decodeURIComponent(href), path);
      if (resolved && resolved !== path && isMarkdownPath(resolved)) out.add(resolved);
    }
    return out;
  }

  private setOutgoing(path: string, text: string): void {
    const before = this.outgoing.get(path) ?? new Set<string>();
    const after = this.linksIn(path, text);
    this.outgoing.set(path, after);
    for (const t of before) {
      if (!after.has(t)) this.backlinks.get(t)?.delete(path);
    }
    for (const t of after) {
      if (!this.backlinks.has(t)) this.backlinks.set(t, new Set());
      this.backlinks.get(t)!.add(path);
    }
  }

  private rebuildLinkGraph(): void {
    this.outgoing.clear();
    this.backlinks.clear();
    for (const [path, text] of this.contents) {
      if (!isMarkdownPath(path) || isHiddenPath(path)) continue;
      this.setOutgoing(path, text);
    }
  }

  backlinksOf(path: string): Backlink[] {
    const sources = this.backlinks.get(path);
    if (!sources) return [];
    const title = noteTitle(path).toLowerCase();
    return [...sources].sort().map((src) => {
      const text = this.contents.get(src) ?? '';
      const line =
        text
          .split('\n')
          .find((l) => l.toLowerCase().includes(`[[${title}`) || l.toLowerCase().includes(title)) ??
        '';
      return { path: src, title: noteTitle(src), context: line.trim().slice(0, 160) };
    });
  }

  outgoingOf(path: string): string[] {
    return [...(this.outgoing.get(path) ?? [])];
  }

  /** Full resolved link graph — nodes are note paths (for the graph view). */
  linkGraph(): { nodes: string[]; edges: [string, string][] } {
    const nodes = [...useVault.getState().notes.keys()];
    const edges: [string, string][] = [];
    for (const [from, targets] of this.outgoing) {
      for (const to of targets) edges.push([from, to]);
    }
    return { nodes, edges };
  }

  outlineOf(path: string): HeadingInfo[] {
    const text = this.contents.get(path);
    return text ? extractOutline(parseFrontmatter(text).body) : [];
  }

  /** Frontmatter property key -> note count, for the All Properties sidebar view. */
  propertyCounts(): { key: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const [path, text] of this.contents) {
      if (!isMarkdownPath(path) || isHiddenPath(path)) continue;
      for (const key of Object.keys(parseFrontmatter(text).data)) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }

  notesWithProperty(key: string): NoteMeta[] {
    const { notes } = useVault.getState();
    const out: NoteMeta[] = [];
    for (const [path, text] of this.contents) {
      if (!notes.has(path)) continue;
      if (key in parseFrontmatter(text).data) out.push(notes.get(path)!);
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Tag -> note count, sorted by count. */
  tagCounts(): { tag: string; count: number }[] {
    const counts = new Map<string, { tag: string; count: number }>();
    for (const meta of useVault.getState().notes.values()) {
      for (const tag of meta.tags) {
        const key = tag.toLowerCase();
        const entry = counts.get(key);
        if (entry) entry.count++;
        else counts.set(key, { tag, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  // ------------------------------------------------------------------
  // Bookmarks (.obsidian/bookmarks.json — Obsidian-compatible, synced)
  // ------------------------------------------------------------------

  private async loadBookmarks(): Promise<void> {
    try {
      const raw = await this.fs.read(BOOKMARKS_FILE);
      const parsed = JSON.parse(raw) as { items?: { type?: string; path?: string }[] };
      const paths = (parsed.items ?? [])
        .filter((i) => i.type === 'file' && typeof i.path === 'string')
        .map((i) => i.path as string);
      useVault.setState({ bookmarks: paths });
    } catch {
      useVault.setState({ bookmarks: [] });
    }
  }

  async toggleBookmark(path: string): Promise<void> {
    const current = useVault.getState().bookmarks;
    const next = current.includes(path)
      ? current.filter((p) => p !== path)
      : [...current, path];
    useVault.setState({ bookmarks: next });
    await this.writeBookmarks(next);
  }

  /** Follow a rename in the bookmarks store + synced .obsidian/bookmarks.json. */
  private async migrateBookmark(from: string, to: string): Promise<void> {
    const { bookmarks } = useVault.getState();
    if (!bookmarks.includes(from)) return;
    const next = bookmarks.map((p) => (p === from ? to : p));
    useVault.setState({ bookmarks: next });
    await this.writeBookmarks(next);
  }

  private async writeBookmarks(paths: string[]): Promise<void> {
    // Preserve any non-file bookmark items Obsidian may have written.
    let items: unknown[] = [];
    try {
      const parsed = JSON.parse(await this.fs.read(BOOKMARKS_FILE)) as { items?: unknown[] };
      items = (parsed.items ?? []).filter((i) => (i as { type?: string }).type !== 'file');
    } catch {
      // fresh file
    }
    const fileItems = paths.map((p) => ({ type: 'file', path: p }));
    await this.fs.write(BOOKMARKS_FILE, JSON.stringify({ items: [...items, ...fileItems] }, null, 2));
    this.onEdited();
  }

  // ------------------------------------------------------------------
  // Daily notes & templates (reads Obsidian's own config when present)
  // ------------------------------------------------------------------

  private async readJsonConfig<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(await this.fs.read(path)) as T;
    } catch {
      return null;
    }
  }

  /**
   * Attachment target folder, from Obsidian's `.obsidian/app.json`
   * (`attachmentFolderPath`). `/` means the vault root; a per-note (`./…`) or
   * unset value falls back to a plain `attachments` folder.
   */
  async attachmentFolder(): Promise<string> {
    const cfg = await this.readJsonConfig<{ attachmentFolderPath?: string }>('.obsidian/app.json');
    const p = cfg?.attachmentFolderPath?.trim();
    if (p === '/') return '';
    if (!p || p.startsWith('.')) return 'attachments';
    return p;
  }

  async dailyNotePath(now = new Date()): Promise<string> {
    const cfg = await this.readJsonConfig<{ folder?: string; format?: string }>(
      '.obsidian/daily-notes.json',
    );
    const name = formatDate(cfg?.format || 'YYYY-MM-DD', now);
    return joinPath(cfg?.folder?.trim() ?? '', `${name}.md`);
  }

  /** Open today's daily note, creating it (from the configured template) if needed. */
  async openDailyNote(): Promise<string> {
    const path = await this.dailyNotePath();
    if (useVault.getState().notes.has(path)) return path;
    const cfg = await this.readJsonConfig<{ template?: string }>('.obsidian/daily-notes.json');
    let body = '';
    if (cfg?.template) {
      const tpl = this.resolver.resolve(cfg.template, '');
      if (tpl) body = await this.fs.read(tpl).catch(() => '');
    }
    await this.fs.write(path, fillTemplate(body, noteTitle(path)));
    this.resolver.add(path);
    await this.afterStructuralChange();
    return path;
  }

  /** Template notes available for "new from template" (folder from Obsidian's templates.json). */
  async listTemplates(): Promise<NoteMeta[]> {
    const cfg = await this.readJsonConfig<{ folder?: string }>('.obsidian/templates.json');
    const folder = cfg?.folder?.trim() || 'Templates';
    const prefix = `${folder}/`;
    return [...useVault.getState().notes.values()]
      .filter((n) => n.path.startsWith(prefix))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async createFromTemplate(templatePath: string, folder = ''): Promise<string> {
    const body = await this.fs.read(templatePath);
    const path = await this.createNote(folder, 'Untitled');
    await this.writeNote(path, fillTemplate(body, noteTitle(path)));
    return path;
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

  /**
   * Full-text search with Obsidian-style operators: `tag:x`, `path:sub/`,
   * `file:name` narrow the results; the remaining words are matched full-text.
   */
  searchNotes(query: string, limit = 30): SearchHit[] {
    const q = query.trim();
    if (!q) return [];

    const filters: ((meta: NoteMeta) => boolean)[] = [];
    const words: string[] = [];
    for (const token of q.split(/\s+/)) {
      const op = /^(tag|path|file):(.*)$/i.exec(token);
      if (!op || !op[2]) {
        words.push(token);
        continue;
      }
      const value = op[2].replace(/^#/, '').toLowerCase();
      if (op[1].toLowerCase() === 'tag') {
        filters.push((m) => m.tags.some((t) => t.toLowerCase().startsWith(value)));
      } else if (op[1].toLowerCase() === 'path') {
        filters.push((m) => m.path.toLowerCase().includes(value));
      } else {
        filters.push((m) => m.title.toLowerCase().includes(value));
      }
    }

    const { notes } = useVault.getState();
    const passes = (path: string): boolean => {
      const meta = notes.get(path);
      return meta !== undefined && filters.every((f) => f(meta));
    };

    const text = words.join(' ');
    if (!text) {
      // Operators only: return every matching note, most recent first.
      return [...notes.values()]
        .filter((m) => filters.every((f) => f(m)))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, limit)
        .map((m) => ({ path: m.path, title: m.title, excerpt: null, score: 0 }));
    }

    return this.search
      .search(text)
      .filter((r) => passes(String(r.id)))
      .slice(0, limit)
      .map((r) => ({
        path: String(r.id),
        title: (r as unknown as { title: string }).title,
        excerpt: this.excerptFor(String(r.id), text),
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
    const body = stripInlineMarkdown(parseFrontmatter(text).body);
    const firstTerm = query.split(/\s+/)[0]?.toLowerCase() ?? '';
    const at = body.toLowerCase().indexOf(firstTerm);
    if (at === -1) return body.slice(0, EXCERPT_RADIUS * 2).replace(/\s+/g, ' ').trim() || null;
    const start = Math.max(0, at - EXCERPT_RADIUS);
    const end = Math.min(body.length, at + firstTerm.length + EXCERPT_RADIUS);
    return `${start > 0 ? '…' : ''}${body.slice(start, end).replace(/\s+/g, ' ').trim()}${end < body.length ? '…' : ''}`;
  }
}

/** Subset of moment-style date tokens used by Obsidian's daily notes. */
export function formatDate(format: string, d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => {
    switch (token) {
      case 'YYYY':
        return String(d.getFullYear());
      case 'MM':
        return pad(d.getMonth() + 1);
      case 'DD':
        return pad(d.getDate());
      case 'HH':
        return pad(d.getHours());
      case 'mm':
        return pad(d.getMinutes());
      default:
        return pad(d.getSeconds());
    }
  });
}

/** Obsidian template variables. */
function fillTemplate(body: string, title: string): string {
  const now = new Date();
  return body
    .replace(/{{\s*title\s*}}/gi, title)
    .replace(/{{\s*date\s*}}/gi, formatDate('YYYY-MM-DD', now))
    .replace(/{{\s*time\s*}}/gi, formatDate('HH:mm', now));
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
