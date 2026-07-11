/**
 * Renderer-side desktop engine: thin adapters that satisfy the GitEngine and
 * VaultFS interfaces by marshaling every call over the `window.basalt` IPC
 * bridge to the Electron main process. All real work (isomorphic-git, Node fs,
 * Keychain) happens in main; the renderer never touches git or the filesystem.
 */
import type { BasaltBridge } from './bridge';
import type {
  Author,
  CommitInfo,
  GitEngine,
  GitProgress,
  MergeOutcome,
  PushOutcome,
  RepoInfo,
  VaultFileInfo,
  VaultFS,
} from './types';

/** The bridge, asserted present — only constructed when isDesktopPlatform is true. */
function bridge(): BasaltBridge {
  const b = window.basalt;
  if (!b) throw new Error('Basalt desktop bridge unavailable');
  return b;
}

export class DesktopGitEngine implements GitEngine {
  setCredentials(opts: { username: string; token: string }): Promise<void> {
    return bridge().git.setCredentials(opts);
  }
  hasCredentials(): Promise<boolean> {
    return bridge().git.hasCredentials();
  }
  clearCredentials(): Promise<void> {
    return bridge().git.clearCredentials();
  }
  listRemoteBranches(opts: {
    url: string;
  }): Promise<{ branches: string[]; defaultBranch?: string }> {
    return bridge().git.listRemoteBranches(opts);
  }
  clone(opts: { url: string; dir: string; branch: string }): Promise<void> {
    return bridge().git.clone(opts);
  }
  repoInfo(opts: { dir: string }): Promise<RepoInfo> {
    return bridge().git.repoInfo(opts);
  }
  deleteRepo(opts: { dir: string }): Promise<void> {
    return bridge().git.deleteRepo(opts);
  }
  status(opts: { dir: string }): Promise<{ dirty: string[] }> {
    return bridge().git.status(opts);
  }
  commitAll(opts: {
    dir: string;
    message: string;
    author: Author;
  }): Promise<{ committed: boolean; oid?: string }> {
    return bridge().git.commitAll(opts);
  }
  fetch(opts: { dir: string }): Promise<{ ahead: number; behind: number }> {
    return bridge().git.fetch(opts);
  }
  merge(opts: { dir: string; conflictSuffix: string; author: Author }): Promise<MergeOutcome> {
    return bridge().git.merge(opts);
  }
  push(opts: { dir: string }): Promise<PushOutcome> {
    return bridge().git.push(opts);
  }
  log(opts: { dir: string; limit?: number; path?: string }): Promise<CommitInfo[]> {
    return bridge().git.log(opts);
  }
  fileAtCommit(opts: { dir: string; oid: string; path: string }): Promise<string | null> {
    return bridge().git.fileAtCommit(opts);
  }
  onProgress(cb: (p: GitProgress) => void): () => void {
    return bridge().git.onProgress(cb);
  }
}

/** VaultFS bound to one vault directory; forwards it on every bridge fs call. */
export class DesktopVaultFS implements VaultFS {
  constructor(private readonly dir: string) {}
  list(): Promise<VaultFileInfo[]> {
    return bridge().fs.list(this.dir);
  }
  read(path: string): Promise<string> {
    return bridge().fs.read(this.dir, path);
  }
  readMany(paths: string[]): Promise<Record<string, string>> {
    return bridge().fs.readMany(this.dir, paths);
  }
  write(path: string, text: string): Promise<void> {
    return bridge().fs.write(this.dir, path, text);
  }
  writeBinary(path: string, base64: string): Promise<void> {
    return bridge().fs.writeBinary(this.dir, path, base64);
  }
  remove(path: string): Promise<void> {
    return bridge().fs.remove(this.dir, path);
  }
  rename(from: string, to: string): Promise<void> {
    return bridge().fs.rename(this.dir, from, to);
  }
  mkdir(path: string): Promise<void> {
    return bridge().fs.mkdir(this.dir, path);
  }
  rmdir(path: string): Promise<void> {
    return bridge().fs.rmdir(this.dir, path);
  }
  fileUrl(path: string): Promise<string> {
    return bridge().fs.fileUrl(this.dir, path);
  }
}
