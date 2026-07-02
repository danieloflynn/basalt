import { dirname } from '@/lib/paths';
import { DEMO_VAULT } from './demoVault';
import type {
  Author,
  CommitInfo,
  GitEngine,
  GitProgress,
  MergeOutcome,
  PushOutcome,
  RepoInfo,
  VaultFS,
  VaultFileInfo,
} from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Shared in-memory state so the mock engine and mock FS see the same files. */
class MemoryStore {
  files = new Map<string, { text: string; mtimeMs: number }>();
  dirty = new Set<string>();
  commits: CommitInfo[] = [];
  cloned = false;
  branch = 'main';
  url = '';

  seed(): void {
    const t = Date.now();
    for (const [path, text] of Object.entries(DEMO_VAULT)) {
      this.files.set(path, { text, mtimeMs: t });
    }
    this.commits = [
      { oid: 'demo0001', message: 'Initial vault', authorName: 'Daniel', when: t - 86_400_000 * 7 },
      { oid: 'demo0002', message: 'notes: desktop edits', authorName: 'Daniel', when: t - 3_600_000 },
    ];
    this.cloned = true;
  }
}

export const memoryStore = new MemoryStore();

export class MockGitEngine implements GitEngine {
  private creds = false;
  private listeners = new Set<(p: GitProgress) => void>();

  private emit(phase: string, percent: number): void {
    for (const cb of this.listeners) cb({ phase, percent });
  }

  async setCredentials(): Promise<void> {
    this.creds = true;
  }

  async hasCredentials(): Promise<boolean> {
    return this.creds;
  }

  async clearCredentials(): Promise<void> {
    this.creds = false;
  }

  async listRemoteBranches(opts: { url: string }): Promise<{ branches: string[]; defaultBranch?: string }> {
    await sleep(600);
    if (!opts.url.includes('/')) throw new Error('Repository not found (mock)');
    return { branches: ['main', 'drafts'], defaultBranch: 'main' };
  }

  async clone(opts: { url: string; dir: string; branch: string }): Promise<void> {
    for (let i = 0; i <= 100; i += 20) {
      this.emit('Receiving objects', i);
      await sleep(120);
    }
    memoryStore.seed();
    memoryStore.url = opts.url;
    memoryStore.branch = opts.branch;
  }

  async repoInfo(): Promise<RepoInfo> {
    return memoryStore.cloned
      ? {
          exists: true,
          branch: memoryStore.branch,
          url: memoryStore.url,
          headOid: memoryStore.commits.at(-1)?.oid,
        }
      : { exists: false };
  }

  async deleteRepo(): Promise<void> {
    memoryStore.files.clear();
    memoryStore.dirty.clear();
    memoryStore.commits = [];
    memoryStore.cloned = false;
  }

  async status(): Promise<{ dirty: string[] }> {
    return { dirty: [...memoryStore.dirty] };
  }

  async commitAll(opts: { dir: string; message: string; author: Author }): Promise<{ committed: boolean; oid?: string }> {
    if (memoryStore.dirty.size === 0) return { committed: false };
    const oid = Math.random().toString(16).slice(2, 10);
    memoryStore.commits.push({
      oid,
      message: opts.message,
      authorName: opts.author.name,
      when: Date.now(),
    });
    memoryStore.dirty.clear();
    return { committed: true, oid };
  }

  async fetch(): Promise<{ ahead: number; behind: number }> {
    await sleep(400);
    return { ahead: 0, behind: 0 };
  }

  async merge(): Promise<MergeOutcome> {
    return { result: 'up-to-date', conflictCopies: [] };
  }

  async push(): Promise<PushOutcome> {
    await sleep(400);
    return { ok: true, rejected: false };
  }

  async log(opts: { dir: string; limit?: number }): Promise<CommitInfo[]> {
    return [...memoryStore.commits].reverse().slice(0, opts.limit ?? 50);
  }

  onProgress(cb: (p: GitProgress) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export class MemoryVaultFS implements VaultFS {
  async list(): Promise<VaultFileInfo[]> {
    return [...memoryStore.files.entries()].map(([path, f]) => ({
      path,
      mtimeMs: f.mtimeMs,
      size: f.text.length,
    }));
  }

  async read(path: string): Promise<string> {
    const f = memoryStore.files.get(path);
    if (!f) throw new Error(`File does not exist: ${path}`);
    return f.text;
  }

  async readMany(paths: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const p of paths) {
      const f = memoryStore.files.get(p);
      if (f) out[p] = f.text;
    }
    return out;
  }

  async write(path: string, text: string): Promise<void> {
    memoryStore.files.set(path, { text, mtimeMs: Date.now() });
    memoryStore.dirty.add(path);
  }

  async writeBinary(path: string): Promise<void> {
    memoryStore.files.set(path, { text: '', mtimeMs: Date.now() });
    memoryStore.dirty.add(path);
  }

  async remove(path: string): Promise<void> {
    memoryStore.files.delete(path);
    memoryStore.dirty.add(path);
  }

  async rename(from: string, to: string): Promise<void> {
    const f = memoryStore.files.get(from);
    if (!f) throw new Error(`File does not exist: ${from}`);
    memoryStore.files.delete(from);
    memoryStore.files.set(to, { ...f, mtimeMs: Date.now() });
    memoryStore.dirty.add(from);
    memoryStore.dirty.add(to);
  }

  async mkdir(): Promise<void> {
    // Folders are implicit in the in-memory store.
  }

  async rmdir(path: string): Promise<void> {
    const prefix = `${path}/`;
    for (const p of [...memoryStore.files.keys()]) {
      if (p.startsWith(prefix) || dirname(p) === path) {
        memoryStore.files.delete(p);
        memoryStore.dirty.add(p);
      }
    }
  }

  async fileUrl(path: string): Promise<string> {
    const f = memoryStore.files.get(path);
    if (!f) return '';
    return URL.createObjectURL(new Blob([f.text], { type: 'text/plain' }));
  }
}
