/**
 * Desktop git engine — the macOS counterpart to the Android Kotlin/JGit plugin.
 * Pure of Electron: every function takes an ABSOLUTE repo path and (for network
 * ops) an injected auth provider, so the tricky merge logic is unit-testable in
 * plain Node. main.ts resolves vault dir → absolute path and wires auth.
 *
 * It implements the same contract as src/engine/types.ts GitEngine, including
 * the core promise: a merge never loses data. On a true conflict the remote
 * version keeps the original filename and the local version is preserved as a
 * "Name (conflict <suffix>).ext" copy, then the merge is committed.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import git, { type WalkerEntry } from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import type {
  Author,
  CommitInfo,
  GitProgress,
  MergeOutcome,
  PushOutcome,
  RepoInfo,
} from '../../src/engine/types';

/** Credentials for a network op, resolved lazily so the PAT never sits in JS. */
export interface AuthProvider {
  (): { username: string; token: string } | null;
}

export interface NetCtx {
  auth: AuthProvider;
  onProgress?: (p: GitProgress) => void;
  /**
   * Prefer the system `git` CLI for fetch/push (external "opened folder"
   * vaults): the CLI transparently uses the user's own credentials — ssh keys,
   * osxkeychain, credential helpers — where isomorphic-git only speaks HTTPS
   * with our stored PAT. Falls back to isomorphic-git when git is missing.
   */
  preferCli?: boolean;
}

// ---------------------------------------------------------------------------
// System git (CLI) — network ops with the user's own credentials
// ---------------------------------------------------------------------------

const execFileP = promisify(execFile);

/**
 * Environment for non-interactive CLI git: never prompt on the terminal (there
 * is none — a prompt would hang the sync forever) and make ssh fail fast
 * instead of asking for passphrases (keys served by the agent still work).
 * A packaged .app gets a minimal PATH, so common git homes are appended.
 */
function cliEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${process.env.PATH ?? '/usr/bin:/bin'}:/usr/local/bin:/opt/homebrew/bin`,
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -oBatchMode=yes',
  };
}

let systemGitChecked: boolean | undefined;

export async function hasSystemGit(): Promise<boolean> {
  if (systemGitChecked === undefined) {
    systemGitChecked = await execFileP('git', ['--version'], { env: cliEnv() }).then(
      () => true,
      () => false,
    );
  }
  return systemGitChecked;
}

async function runGit(
  dir: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileP('git', ['-C', dir, ...args], {
    env: cliEnv(),
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** Translate CLI git's auth/network failures into actionable messages. */
function asFriendlyCliError(e: unknown): Error {
  const err = e as { stderr?: string; message?: string };
  const detail = (err.stderr ?? err.message ?? String(e)).trim();
  if (/terminal prompts disabled|could not read Username|Authentication failed/i.test(detail)) {
    return new Error(
      `Command-line git couldn't authenticate for this repository. Run a git fetch ` +
        `in this folder from a terminal once (so your credential helper stores a ` +
        `login), or configure git credentials for this remote. (${firstLine(detail)})`,
    );
  }
  if (/permission denied \(publickey\)|host key verification failed/i.test(detail)) {
    return new Error(
      `Command-line git couldn't authenticate over ssh. Make sure your ssh key is ` +
        `loaded (ssh-add) or reachable via your agent. (${firstLine(detail)})`,
    );
  }
  return new Error(firstLine(detail) || 'git command failed');
}

function firstLine(s: string): string {
  // Surface the most meaningful stderr line: prefer fatal/error lines.
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /^(fatal|error):/i.test(l)) ?? lines[0] ?? '';
}

/** Repo-configured commit identity (resolves local + global config), if any. */
export async function configAuthor(
  dir: string,
): Promise<{ name?: string; email?: string }> {
  if (!(await hasSystemGit())) return {};
  const get = (key: string) =>
    runGit(dir, ['config', key]).then(
      (r) => r.stdout.trim() || undefined,
      () => undefined,
    );
  const [name, email] = await Promise.all([get('user.name'), get('user.email')]);
  return { name, email };
}

const decoder = new TextDecoder();

/** isomorphic-git onAuth from our stored PAT. GitHub takes the token as the
 *  password; the username can be anything non-empty. */
function onAuthFrom(auth: AuthProvider) {
  return () => {
    const c = auth();
    if (!c) throw new Error('No git credentials configured');
    return { username: c.username || c.token, password: c.token };
  };
}

/**
 * GitHub draws a sharp line that isomorphic-git's bare "HTTP Error: 403
 * Forbidden" hides: 401 means the token was not accepted at all (missing,
 * mistyped, or expired), while 403 means the token authenticated fine but that
 * identity is not permitted to reach this repository. The fixes are completely
 * different, so translate the two common auth failures into an actionable
 * message — keeping GitHub's own response body — and pass everything else
 * (including our own "No git credentials configured") through untouched.
 */
export function asFriendlyNetworkError(e: unknown): unknown {
  const err = e as { name?: string; data?: { statusCode?: number; response?: string } };
  if (err?.name !== 'HttpError') return e;
  const status = err.data?.statusCode;
  const body = (err.data?.response ?? '').trim();
  const detail = body ? ` (GitHub: ${body})` : '';
  if (status === 401) {
    return new Error(
      `GitHub rejected the credentials (401). Check the personal access token is ` +
        `correct and has not expired.${detail}`,
    );
  }
  if (status === 403) {
    return new Error(
      `GitHub forbade access to this repository (403). The token authenticated but ` +
        `is not allowed to reach this repo. For a fine-grained token, grant it access ` +
        `to this repository and set the "Contents" permission to at least Read (Read ` +
        `and write is required to push). For a classic token, enable the "repo" scope.${detail}`,
    );
  }
  return e;
}

/** Run a network op, translating GitHub's opaque auth failures on the way out. */
async function withFriendlyErrors<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e) {
    throw asFriendlyNetworkError(e);
  }
}

function onProgressFrom(ctx: NetCtx) {
  if (!ctx.onProgress) return undefined;
  const emit = ctx.onProgress;
  return (e: { phase: string; loaded?: number; total?: number }) => {
    emit({
      phase: e.phase,
      percent: e.total ? Math.round(((e.loaded ?? 0) / e.total) * 100) : -1,
    });
  };
}

/** A signature with a real timestamp (the interface's Author is name+email only). */
function sig(author: Author) {
  return {
    name: author.name,
    email: author.email,
    timestamp: Math.floor(Date.now() / 1000),
    timezoneOffset: new Date().getTimezoneOffset(),
  };
}

/** Insert " (conflict <suffix>)" before the extension: A.md → A (conflict 3f2a).md */
export function conflictCopyName(filepath: string, suffix: string): string {
  const dir = path.posix.dirname(filepath);
  const ext = path.posix.extname(filepath);
  const base = path.posix.basename(filepath, ext);
  const name = `${base} (conflict ${suffix})${ext}`;
  return dir === '.' ? name : `${dir}/${name}`;
}

// ---------------------------------------------------------------------------
// Local (network-free) operations
// ---------------------------------------------------------------------------

export async function repoInfo(dir: string): Promise<RepoInfo> {
  try {
    await fsp.access(path.join(dir, '.git'));
  } catch {
    return { exists: false };
  }
  const [branch, headOid, url] = await Promise.all([
    git.currentBranch({ fs, dir, fullname: false }).catch(() => undefined),
    git.resolveRef({ fs, dir, ref: 'HEAD' }).catch(() => undefined),
    git.getConfig({ fs, dir, path: 'remote.origin.url' }).catch(() => undefined),
  ]);
  return { exists: true, branch: branch ?? undefined, headOid, url };
}

export async function deleteRepo(dir: string): Promise<void> {
  await fsp.rm(dir, { recursive: true, force: true });
}

interface Changes {
  added: string[];
  modified: string[];
  deleted: string[];
}

/**
 * Compare the working tree to HEAD by CONTENT HASH, not the index's cached
 * (mtime, size) stat. statusMatrix's stat shortcut can miss a same-size edit
 * made in the same mtime tick as the last checkout — which for a vault app
 * would mean an uncommitted edit silently overwritten by the next merge. We use
 * statusMatrix only to enumerate non-ignored paths (so .gitignore is honored),
 * then re-hash each file to decide the truth.
 */
async function changesVsHead(dir: string): Promise<Changes> {
  const matrix = await git.statusMatrix({ fs, dir });
  const headOids = new Map<string, string>();
  try {
    const headCommit = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    await git.walk({
      fs,
      dir,
      trees: [git.TREE({ ref: headCommit })],
      map: async (filepath, [entry]) => {
        if (filepath === '.' || !entry) return;
        if ((await entry.type()) === 'blob') headOids.set(filepath, await entry.oid());
      },
    });
  } catch {
    // No HEAD yet (freshly init'd repo) — everything present is an addition.
  }
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const [filepath] of matrix) {
    let workOid: string | null = null;
    try {
      const content = await fsp.readFile(path.join(dir, filepath));
      workOid = (await git.hashBlob({ object: content })).oid;
    } catch {
      workOid = null; // absent from the working tree
    }
    const headOid = headOids.get(filepath) ?? null;
    if (workOid && !headOid) added.push(filepath);
    else if (!workOid && headOid) deleted.push(filepath);
    else if (workOid && headOid && workOid !== headOid) modified.push(filepath);
  }
  return { added, modified, deleted };
}

/** Vault-relative paths that differ from HEAD (added / modified / deleted). */
export async function status(dir: string): Promise<string[]> {
  const { added, modified, deleted } = await changesVsHead(dir);
  return [...added, ...modified, ...deleted];
}

export async function commitAll(
  dir: string,
  message: string,
  author: Author,
): Promise<{ committed: boolean; oid?: string }> {
  const { added, modified, deleted } = await changesVsHead(dir);
  if (added.length + modified.length + deleted.length === 0) return { committed: false };
  for (const filepath of [...added, ...modified]) await git.add({ fs, dir, filepath });
  for (const filepath of deleted) await git.remove({ fs, dir, filepath });
  const s = sig(author);
  const oid = await git.commit({ fs, dir, message, author: s, committer: s });
  return { committed: true, oid };
}

export async function log(
  dir: string,
  opts: { limit?: number; path?: string } = {},
): Promise<CommitInfo[]> {
  const commits = await git.log({
    fs,
    dir,
    depth: opts.limit,
    filepath: opts.path,
    force: true,
  });
  return commits.map((c) => ({
    oid: c.oid,
    message: c.commit.message.trimEnd(), // git stores a trailing newline
    authorName: c.commit.author.name,
    when: c.commit.author.timestamp * 1000,
  }));
}

export async function fileAtCommit(
  dir: string,
  oid: string,
  filepath: string,
): Promise<string | null> {
  try {
    const { blob } = await git.readBlob({ fs, dir, oid, filepath });
    return decoder.decode(blob);
  } catch {
    return null; // absent in that commit
  }
}

// ---------------------------------------------------------------------------
// Merge — the "never lose data" core, testable without a network.
// ---------------------------------------------------------------------------

interface Decision {
  filepath: string;
  take: 'theirs' | 'both';
  oursOid: string | null;
  theirsOid: string | null;
}

async function blobInfo(
  entry: WalkerEntry | null,
): Promise<{ oid: string | null; isTree: boolean }> {
  if (!entry) return { oid: null, isTree: false };
  const type = await entry.type();
  if (type === 'tree') return { oid: null, isTree: true };
  if (type !== 'blob') return { oid: null, isTree: false };
  return { oid: await entry.oid(), isTree: false };
}

/**
 * Refuse to write through a symlink. A repo can commit a symlink (mode 120000),
 * which git.checkout materializes on disk; a later merge writing a path under
 * that link would escape the vault (e.g. into ~/.ssh). isomorphic-git guards its
 * own checkout (assertNoSymlinkInLeadingPath); this custom merge writer must too.
 * Rejects if any existing component of the path — leading dir OR leaf — is a
 * symlink. Non-existent components are fine (they'll be created as real files).
 */
export async function assertNoSymlinkOnPath(dir: string, filepath: string): Promise<void> {
  const parts = filepath.split('/').filter(Boolean);
  let cur = dir;
  for (const part of parts) {
    cur = path.join(cur, part);
    let st;
    try {
      st = await fsp.lstat(cur);
    } catch {
      return; // this and everything below it doesn't exist yet — safe
    }
    if (st.isSymbolicLink()) {
      throw new Error(`Refusing to write through a symlink in the vault: ${filepath}`);
    }
  }
}

async function writeBlobToWorking(dir: string, filepath: string, oid: string): Promise<void> {
  await assertNoSymlinkOnPath(dir, filepath);
  const { blob } = await git.readBlob({ fs, dir, oid });
  const abs = path.join(dir, filepath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, Buffer.from(blob));
}

/**
 * Merge origin/<branch> into HEAD. Fast-forwards when it can; otherwise does a
 * tree-level 3-way merge where each file is decided by comparing its blob oid in
 * base / ours / theirs. Files changed on only one side take that side; files
 * changed differently on both sides conflict — and conflicts keep BOTH copies
 * (remote under the original name, local as a conflict copy) instead of writing
 * conflict markers. Always ends in a committed, clean working tree.
 */
export async function merge(
  dir: string,
  opts: { branch?: string; conflictSuffix: string; author: Author },
): Promise<MergeOutcome> {
  const branch = opts.branch ?? (await git.currentBranch({ fs, dir, fullname: false }));
  if (!branch) throw new Error('merge: repository has no current branch');

  // A vault autosave can land on disk between the caller's commitAll and this
  // merge — fetch() is a multi-second network op, and sync's push-retry loop
  // re-enters fetch→merge without re-committing. Both checkout paths below
  // force-reset the WHOLE working tree to a ref, which would silently revert
  // such a stray edit to HEAD: data loss with no conflict copy, breaking the
  // "a merge never loses data" promise. Capture any uncommitted change as a
  // commit first, so it flows through the 3-way merge (kept as-is, or preserved
  // as a conflict copy) instead of being discarded. No-op when the caller left
  // the tree clean, which is the normal case.
  await commitAll(dir, 'Local edits captured before merge', opts.author);

  const oursOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
  const theirsOid = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` });

  if (oursOid === theirsOid) return { result: 'up-to-date', conflictCopies: [] };

  const bases = await git.findMergeBase({ fs, dir, oids: [oursOid, theirsOid] });
  const baseOid = bases[0];

  // Remote already contains our history: nothing to do.
  if (baseOid === theirsOid) return { result: 'up-to-date', conflictCopies: [] };

  // Our history is an ancestor of remote: fast-forward.
  if (baseOid === oursOid) {
    await git.writeRef({ fs, dir, ref: `refs/heads/${branch}`, value: theirsOid, force: true });
    await git.checkout({ fs, dir, ref: branch, force: true });
    return { result: 'fast-forward', conflictCopies: [] };
  }

  // Divergent: reset working tree + index to our HEAD, then apply theirs on top.
  await git.checkout({ fs, dir, ref: branch, force: true });

  const decisions: Decision[] = [];
  await git.walk({
    fs,
    dir,
    trees: [
      baseOid ? git.TREE({ ref: baseOid }) : git.TREE({ ref: oursOid }), // no base ⇒ compare vs ours
      git.TREE({ ref: oursOid }),
      git.TREE({ ref: theirsOid }),
    ],
    map: async (filepath, entries) => {
      if (filepath === '.') return;
      const [b, o, t] = entries;
      const [bi, oi, ti] = await Promise.all([blobInfo(b), blobInfo(o), blobInfo(t)]);
      // A directory on any side: let walk recurse into its children.
      if (bi.isTree || oi.isTree || ti.isTree) return;
      const bOid = baseOid ? bi.oid : null; // treat "no merge base" as empty base
      const oOid = oi.oid;
      const tOid = ti.oid;
      if (oOid === tOid) return; // identical on both sides (incl. both absent)
      if (oOid === bOid) {
        decisions.push({ filepath, take: 'theirs', oursOid: oOid, theirsOid: tOid });
        return;
      }
      if (tOid === bOid) return; // theirs unchanged — ours already in the tree
      decisions.push({ filepath, take: 'both', oursOid: oOid, theirsOid: tOid });
    },
  });

  const conflictCopies: string[] = [];
  const toAdd: string[] = [];
  const toRemove: string[] = [];

  // Apply the decisions, then commit — as a unit. If any write throws (e.g. a
  // file⇄directory name swap yielding ENOTDIR, or the symlink guard firing), the
  // working tree would be left half-mutated and uncommitted; the NEXT sync's
  // pre-merge commitAll would then capture that partial state as a corrupt
  // commit. So on any failure, undo: drop the conflict copies we wrote and
  // hard-reset the tree back to our HEAD. The local work is safe in the `ours`
  // commit; syncNow surfaces the error for manual resolution instead of
  // corrupting the vault.
  try {
    for (const d of decisions) {
      // Remote keeps the original name (or the deletion).
      if (d.theirsOid == null) {
        await fsp.rm(path.join(dir, d.filepath), { force: true });
        toRemove.push(d.filepath);
      } else {
        await writeBlobToWorking(dir, d.filepath, d.theirsOid);
        toAdd.push(d.filepath);
      }
      // On a true conflict, preserve our version alongside it.
      if (d.take === 'both' && d.oursOid != null) {
        const copy = conflictCopyName(d.filepath, opts.conflictSuffix);
        await writeBlobToWorking(dir, copy, d.oursOid);
        toAdd.push(copy);
        conflictCopies.push(copy);
      }
    }

    for (const p of toAdd) await git.add({ fs, dir, filepath: p });
    for (const p of toRemove) await git.remove({ fs, dir, filepath: p });

    const s = sig(opts.author);
    await git.commit({
      fs,
      dir,
      message: `Merge origin/${branch}`,
      author: s,
      committer: s,
      parent: [oursOid, theirsOid],
    });
  } catch (e) {
    for (const copy of conflictCopies) {
      await fsp.rm(path.join(dir, copy), { force: true }).catch(() => {});
    }
    await git.checkout({ fs, dir, ref: branch, force: true });
    throw e;
  }

  return { result: conflictCopies.length ? 'conflicts' : 'merged', conflictCopies };
}

// ---------------------------------------------------------------------------
// Network operations
// ---------------------------------------------------------------------------

export async function listRemoteBranches(
  url: string,
  ctx: NetCtx,
): Promise<{ branches: string[]; defaultBranch?: string }> {
  const refs = await withFriendlyErrors(() =>
    git.listServerRefs({
      http,
      url,
      prefix: 'refs/heads/',
      symrefs: true,
      onAuth: onAuthFrom(ctx.auth),
    }),
  );
  const branches: string[] = [];
  let defaultBranch: string | undefined;
  for (const r of refs) {
    if (r.ref.startsWith('refs/heads/')) branches.push(r.ref.slice('refs/heads/'.length));
    if (r.ref === 'HEAD' && r.target?.startsWith('refs/heads/')) {
      defaultBranch = r.target.slice('refs/heads/'.length);
    }
  }
  return { branches, defaultBranch };
}

export async function clone(
  dir: string,
  opts: { url: string; branch: string },
  ctx: NetCtx,
): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
  await withFriendlyErrors(() =>
    git.clone({
      fs,
      http,
      dir,
      url: opts.url,
      ref: opts.branch,
      singleBranch: true,
      onAuth: onAuthFrom(ctx.auth),
      onProgress: onProgressFrom(ctx),
    }),
  );
}

export async function fetch(
  dir: string,
  ctx: NetCtx,
): Promise<{ ahead: number; behind: number }> {
  const branch = await git.currentBranch({ fs, dir, fullname: false });
  if (!branch) throw new Error('fetch: repository has no current branch');
  if (ctx.preferCli && (await hasSystemGit())) {
    ctx.onProgress?.({ phase: 'Fetching (git)', percent: -1 });
    try {
      await runGit(dir, ['fetch', 'origin', branch, '--no-tags']);
    } catch (e) {
      throw asFriendlyCliError(e);
    }
  } else {
    await withFriendlyErrors(() =>
      git.fetch({
        fs,
        http,
        dir,
        remote: 'origin',
        ref: branch,
        singleBranch: true,
        tags: false,
        onAuth: onAuthFrom(ctx.auth),
        onProgress: onProgressFrom(ctx),
      }),
    );
  }
  const oursOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
  const theirsOid = await git
    .resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` })
    .catch(() => oursOid);
  const base = (await git.findMergeBase({ fs, dir, oids: [oursOid, theirsOid] }))[0];
  const [ahead, behind] = await Promise.all([
    countTo(dir, oursOid, base),
    countTo(dir, theirsOid, base),
  ]);
  return { ahead, behind };
}

/** Commits reachable from `head` before reaching `stop` (bounded). */
async function countTo(dir: string, head: string, stop: string | undefined): Promise<number> {
  if (!stop || head === stop) return 0;
  const commits = await git.log({ fs, dir, ref: head, depth: 500 }).catch(() => []);
  let n = 0;
  for (const c of commits) {
    if (c.oid === stop) break;
    n++;
  }
  return n;
}

export async function push(dir: string, ctx: NetCtx): Promise<PushOutcome> {
  const branch = await git.currentBranch({ fs, dir, fullname: false });
  if (!branch) throw new Error('push: repository has no current branch');
  if (ctx.preferCli && (await hasSystemGit())) {
    ctx.onProgress?.({ phase: 'Pushing (git)', percent: -1 });
    try {
      await runGit(dir, ['push', 'origin', branch]);
      return { ok: true, rejected: false };
    } catch (e) {
      const stderr = String((e as { stderr?: string }).stderr ?? '');
      // The remote moved underneath us — sync's retry loop pulls and re-pushes.
      if (/\[rejected\]|non-fast-forward|fetch first/i.test(stderr)) {
        return { ok: false, rejected: true, message: firstLine(stderr) };
      }
      return { ok: false, rejected: false, message: asFriendlyCliError(e).message };
    }
  }
  try {
    const res = await git.push({
      fs,
      http,
      dir,
      remote: 'origin',
      ref: branch,
      onAuth: onAuthFrom(ctx.auth),
      onProgress: onProgressFrom(ctx),
    });
    // PushResult reports an overall `error` plus a per-ref `refs` map; a
    // non-fast-forward push usually throws PushRejectedError (caught below) but
    // can also surface as a rejected ref here.
    const refErrors = Object.values(res.refs ?? {})
      .filter((r) => !r.ok)
      .map((r) => r.error)
      .filter((m): m is string => Boolean(m));
    if (res.ok === false || refErrors.length > 0) {
      const message = [res.error, ...refErrors].filter(Boolean).join('; ');
      return { ok: false, rejected: /not-fast-forward|fast.?forward/i.test(message), message };
    }
    return { ok: true, rejected: false };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === 'PushRejectedError') {
      return { ok: false, rejected: true, message: err.message };
    }
    throw asFriendlyNetworkError(e);
  }
}
