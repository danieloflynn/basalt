/**
 * The `window.basalt` bridge the Electron preload exposes to the renderer. It
 * mirrors the GitEngine + VaultFS contracts, with the vault directory passed
 * explicitly on every fs call (the renderer's DesktopVaultFS carries it). Kept
 * in one place, importing only relative payload types, so both the renderer and
 * the preload's own tsconfig can resolve it without path aliases.
 */
import type {
  Author,
  CommitInfo,
  GitProgress,
  MergeOutcome,
  PushOutcome,
  RepoInfo,
  VaultFileInfo,
} from './types';

export interface BasaltBridge {
  platform: 'electron';
  git: {
    setCredentials(opts: { username: string; token: string }): Promise<void>;
    hasCredentials(): Promise<boolean>;
    clearCredentials(): Promise<void>;
    listRemoteBranches(opts: {
      url: string;
    }): Promise<{ branches: string[]; defaultBranch?: string }>;
    clone(opts: { url: string; dir: string; branch: string }): Promise<void>;
    repoInfo(opts: { dir: string }): Promise<RepoInfo>;
    deleteRepo(opts: { dir: string }): Promise<void>;
    status(opts: { dir: string }): Promise<{ dirty: string[] }>;
    commitAll(opts: {
      dir: string;
      message: string;
      author: Author;
    }): Promise<{ committed: boolean; oid?: string }>;
    fetch(opts: { dir: string }): Promise<{ ahead: number; behind: number }>;
    merge(opts: {
      dir: string;
      conflictSuffix: string;
      author: Author;
    }): Promise<MergeOutcome>;
    push(opts: { dir: string }): Promise<PushOutcome>;
    log(opts: { dir: string; limit?: number; path?: string }): Promise<CommitInfo[]>;
    fileAtCommit(opts: { dir: string; oid: string; path: string }): Promise<string | null>;
    onProgress(cb: (p: GitProgress) => void): () => void;
  };
  vault: {
    /**
     * Native folder picker for "Open a folder as vault". Registers the picked
     * folder with the main process (the only way an out-of-sandbox path becomes
     * usable as a vault dir) and reports whether it's already a git clone.
     * Null when the user cancels.
     */
    pickFolder(): Promise<{ dir: string; name: string; repo: RepoInfo } | null>;
  };
  fs: {
    list(dir: string): Promise<VaultFileInfo[]>;
    read(dir: string, path: string): Promise<string>;
    readMany(dir: string, paths: string[]): Promise<Record<string, string>>;
    write(dir: string, path: string, text: string): Promise<void>;
    writeBinary(dir: string, path: string, base64: string): Promise<void>;
    remove(dir: string, path: string): Promise<void>;
    rename(dir: string, from: string, to: string): Promise<void>;
    mkdir(dir: string, path: string): Promise<void>;
    rmdir(dir: string, path: string): Promise<void>;
    fileUrl(dir: string, path: string): Promise<string>;
  };
  openExternal(dir: string, path: string): Promise<void>;
}
