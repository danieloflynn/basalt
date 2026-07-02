/**
 * The GitEngine is the only doorway between the app and git. On device it is
 * implemented by the BasaltGit Capacitor plugin (Kotlin + JGit); in the
 * browser it is implemented by a mock so the whole UI can be developed and
 * tested without a device. The UI never talks to git directly — it goes
 * through SyncService, which drives this interface.
 */

export interface CommitInfo {
  oid: string;
  message: string;
  authorName: string;
  /** Epoch milliseconds. */
  when: number;
}

export type MergeResultKind = 'up-to-date' | 'fast-forward' | 'merged' | 'conflicts';

export interface MergeOutcome {
  result: MergeResultKind;
  /** Vault paths of conflict copies created (local versions preserved as new files). */
  conflictCopies: string[];
}

export interface PushOutcome {
  ok: boolean;
  /** True when the remote rejected a non-fast-forward — caller should fetch/merge and retry. */
  rejected: boolean;
  message?: string;
}

export interface GitProgress {
  /** e.g. 'Receiving objects', 'Resolving deltas' */
  phase: string;
  /** 0..100, or -1 when indeterminate. */
  percent: number;
}

export interface RepoInfo {
  exists: boolean;
  branch?: string;
  url?: string;
  headOid?: string;
}

export interface Author {
  name: string;
  email: string;
}

export interface GitEngine {
  /** Store the GitHub PAT in OS-secure storage (Android Keystore-backed). Never persisted in JS. */
  setCredentials(opts: { username: string; token: string }): Promise<void>;
  hasCredentials(): Promise<boolean>;
  clearCredentials(): Promise<void>;

  /** List branches of a remote before cloning (also validates URL + auth). */
  listRemoteBranches(opts: { url: string }): Promise<{ branches: string[]; defaultBranch?: string }>;

  clone(opts: { url: string; dir: string; branch: string }): Promise<void>;
  repoInfo(opts: { dir: string }): Promise<RepoInfo>;
  deleteRepo(opts: { dir: string }): Promise<void>;

  /** Vault-relative paths of files that differ from HEAD (added/modified/deleted). */
  status(opts: { dir: string }): Promise<{ dirty: string[] }>;
  commitAll(opts: { dir: string; message: string; author: Author }): Promise<{ committed: boolean; oid?: string }>;
  fetch(opts: { dir: string }): Promise<{ ahead: number; behind: number }>;
  /**
   * Merge origin/<branch> into HEAD. On true conflicts, the remote version
   * keeps the original filename and the local version is preserved as a
   * conflict copy ("Note (conflict <suffix>).md"), then the merge is
   * committed. Data is never lost.
   */
  merge(opts: { dir: string; conflictSuffix: string; author: Author }): Promise<MergeOutcome>;
  push(opts: { dir: string }): Promise<PushOutcome>;
  log(opts: { dir: string; limit?: number; path?: string }): Promise<CommitInfo[]>;
  /** Content of a file as of a given commit, or null if absent there (D-4). */
  fileAtCommit(opts: { dir: string; oid: string; path: string }): Promise<string | null>;

  onProgress(cb: (p: GitProgress) => void): () => void;
}

/** Text shared into the app from other Android apps (share sheet). */
export interface SharedItem {
  text: string;
  subject?: string;
}

export interface VaultFileInfo {
  path: string;
  mtimeMs: number;
  size: number;
}

/**
 * File access to the working tree. On device this is real files under the
 * app's data dir (a normal git working tree — recoverable with plain git).
 */
export interface VaultFS {
  list(): Promise<VaultFileInfo[]>;
  read(path: string): Promise<string>;
  /** Bulk read used to build the search index without N bridge round-trips. */
  readMany(paths: string[]): Promise<Record<string, string>>;
  write(path: string, text: string): Promise<void>;
  writeBinary(path: string, base64: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  /** Recursive folder delete. */
  rmdir(path: string): Promise<void>;
  /** A URL the webview can display (images, PDFs). */
  fileUrl(path: string): Promise<string>;
}
