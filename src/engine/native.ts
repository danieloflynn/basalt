import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { dirname, joinPath } from '@/lib/paths';
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

/** Raw surface of the Kotlin plugin. All `dir` values are relative to the app's filesDir. */
interface BasaltGitPlugin {
  setCredentials(o: { username: string; token: string }): Promise<void>;
  hasCredentials(): Promise<{ value: boolean }>;
  clearCredentials(): Promise<void>;
  listRemoteBranches(o: { url: string }): Promise<{ branches: string[]; defaultBranch?: string }>;
  clone(o: { url: string; dir: string; branch: string }): Promise<void>;
  repoInfo(o: { dir: string }): Promise<RepoInfo>;
  deleteRepo(o: { dir: string }): Promise<void>;
  listFiles(o: { dir: string }): Promise<{ files: VaultFileInfo[] }>;
  readMany(o: { dir: string; paths: string[] }): Promise<{ contents: Record<string, string> }>;
  status(o: { dir: string }): Promise<{ dirty: string[] }>;
  commitAll(o: {
    dir: string;
    message: string;
    authorName: string;
    authorEmail: string;
  }): Promise<{ committed: boolean; oid?: string }>;
  fetch(o: { dir: string }): Promise<{ ahead: number; behind: number }>;
  merge(o: {
    dir: string;
    conflictSuffix: string;
    authorName: string;
    authorEmail: string;
  }): Promise<MergeOutcome>;
  push(o: { dir: string }): Promise<PushOutcome>;
  log(o: { dir: string; limit?: number; path?: string }): Promise<{ commits: CommitInfo[] }>;
  fileAtCommit(o: { dir: string; oid: string; path: string }): Promise<{ content: string | null }>;
  openFile(o: { dir: string; path: string }): Promise<void>;
  consumePendingShares(): Promise<{ items: { text: string; subject?: string }[] }>;
  addListener(
    eventName: 'progress',
    cb: (e: GitProgress) => void,
  ): Promise<PluginListenerHandle>;
}

const BasaltGit = registerPlugin<BasaltGitPlugin>('BasaltGit');

/** Open a vault file in an external Android app (PDFs etc.). */
export function nativeOpenFile(dir: string, path: string): Promise<void> {
  return BasaltGit.openFile({ dir, path });
}

/** Drain text shared into the app via the Android share sheet. */
export async function nativeConsumePendingShares(): Promise<{ text: string; subject?: string }[]> {
  return (await BasaltGit.consumePendingShares()).items;
}

export class NativeGitEngine implements GitEngine {
  async setCredentials(opts: { username: string; token: string }): Promise<void> {
    await BasaltGit.setCredentials(opts);
  }

  async hasCredentials(): Promise<boolean> {
    return (await BasaltGit.hasCredentials()).value;
  }

  async clearCredentials(): Promise<void> {
    await BasaltGit.clearCredentials();
  }

  listRemoteBranches(opts: { url: string }): Promise<{ branches: string[]; defaultBranch?: string }> {
    return BasaltGit.listRemoteBranches(opts);
  }

  async clone(opts: { url: string; dir: string; branch: string }): Promise<void> {
    await BasaltGit.clone(opts);
  }

  repoInfo(opts: { dir: string }): Promise<RepoInfo> {
    return BasaltGit.repoInfo(opts);
  }

  async deleteRepo(opts: { dir: string }): Promise<void> {
    await BasaltGit.deleteRepo(opts);
  }

  status(opts: { dir: string }): Promise<{ dirty: string[] }> {
    return BasaltGit.status(opts);
  }

  commitAll(opts: {
    dir: string;
    message: string;
    author: Author;
  }): Promise<{ committed: boolean; oid?: string }> {
    return BasaltGit.commitAll({
      dir: opts.dir,
      message: opts.message,
      authorName: opts.author.name,
      authorEmail: opts.author.email,
    });
  }

  fetch(opts: { dir: string }): Promise<{ ahead: number; behind: number }> {
    return BasaltGit.fetch(opts);
  }

  merge(opts: { dir: string; conflictSuffix: string; author: Author }): Promise<MergeOutcome> {
    return BasaltGit.merge({
      dir: opts.dir,
      conflictSuffix: opts.conflictSuffix,
      authorName: opts.author.name,
      authorEmail: opts.author.email,
    });
  }

  push(opts: { dir: string }): Promise<PushOutcome> {
    return BasaltGit.push(opts);
  }

  async log(opts: { dir: string; limit?: number; path?: string }): Promise<CommitInfo[]> {
    return (await BasaltGit.log(opts)).commits;
  }

  async fileAtCommit(opts: { dir: string; oid: string; path: string }): Promise<string | null> {
    return (await BasaltGit.fileAtCommit(opts)).content;
  }

  onProgress(cb: (p: GitProgress) => void): () => void {
    const handle = BasaltGit.addListener('progress', cb);
    return () => {
      void handle.then((h) => h.remove());
    };
  }
}

/**
 * Real files under <filesDir>/<vaultDir> — the same directory the git plugin
 * operates on, so the vault is always a plain git working tree (D-3).
 */
export class NativeVaultFS implements VaultFS {
  constructor(private vaultDir: string) {}

  private p(path: string): string {
    return joinPath(this.vaultDir, path);
  }

  async list(): Promise<VaultFileInfo[]> {
    return (await BasaltGit.listFiles({ dir: this.vaultDir })).files;
  }

  async read(path: string): Promise<string> {
    const res = await Filesystem.readFile({
      path: this.p(path),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    return res.data as string;
  }

  async readMany(paths: string[]): Promise<Record<string, string>> {
    return (await BasaltGit.readMany({ dir: this.vaultDir, paths })).contents;
  }

  async write(path: string, text: string): Promise<void> {
    await Filesystem.writeFile({
      path: this.p(path),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      data: text,
      recursive: true,
    });
  }

  async writeBinary(path: string, base64: string): Promise<void> {
    await Filesystem.writeFile({
      path: this.p(path),
      directory: Directory.Data,
      data: base64,
      recursive: true,
    });
  }

  async remove(path: string): Promise<void> {
    await Filesystem.deleteFile({ path: this.p(path), directory: Directory.Data });
  }

  async rename(from: string, to: string): Promise<void> {
    const toDir = dirname(this.p(to));
    if (toDir) {
      await Filesystem.mkdir({ path: toDir, directory: Directory.Data, recursive: true }).catch(
        () => undefined,
      );
    }
    await Filesystem.rename({
      from: this.p(from),
      to: this.p(to),
      directory: Directory.Data,
      toDirectory: Directory.Data,
    });
  }

  async mkdir(path: string): Promise<void> {
    await Filesystem.mkdir({ path: this.p(path), directory: Directory.Data, recursive: true });
  }

  async rmdir(path: string): Promise<void> {
    await Filesystem.rmdir({ path: this.p(path), directory: Directory.Data, recursive: true });
  }

  async fileUrl(path: string): Promise<string> {
    const { uri } = await Filesystem.getUri({ path: this.p(path), directory: Directory.Data });
    return Capacitor.convertFileSrc(uri);
  }
}
