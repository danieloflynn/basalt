// @vitest-environment node
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import git from 'isomorphic-git';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertNoSymlinkOnPath,
  commitAll,
  conflictCopyName,
  fileAtCommit,
  log,
  merge,
  status,
} from './engine';

const author = { name: 'Tester', email: 'test@basalt.app' };
let dir: string;

async function put(rel: string, text: string) {
  const abs = path.join(dir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, text);
}
const read = (rel: string) => readFile(path.join(dir, rel), 'utf8');

/** Init a repo on `main` with an initial commit of the given files. */
async function initRepo(files: Record<string, string>): Promise<string> {
  await git.init({ fs, dir, defaultBranch: 'main' });
  for (const [rel, text] of Object.entries(files)) await put(rel, text);
  const { oid } = await commitAll(dir, 'base', author);
  return oid!;
}

/**
 * Build a divergence: from base commit C0, apply `ours` on main (HEAD) and
 * `theirs` on refs/remotes/origin/main. A file mapped to null is deleted.
 * Leaves the working tree on `main` with `ours` applied — ready to merge().
 */
async function diverge(
  base: string,
  ours: Record<string, string | null>,
  theirs: Record<string, string | null>,
): Promise<void> {
  // Remote side first, off a detached base, so main keeps pointing at C0.
  await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/main', value: base, force: true });
  await git.checkout({ fs, dir, ref: base, force: true });
  for (const [rel, text] of Object.entries(theirs)) {
    if (text === null) await rm(path.join(dir, rel), { force: true });
    else await put(rel, text);
  }
  const t = await commitAll(dir, 'theirs', author);
  await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/main', value: t.oid!, force: true });

  // Back to main, apply ours.
  await git.checkout({ fs, dir, ref: 'main', force: true });
  for (const [rel, text] of Object.entries(ours)) {
    if (text === null) await rm(path.join(dir, rel), { force: true });
    else await put(rel, text);
  }
  await commitAll(dir, 'ours', author);
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'basalt-git-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('conflictCopyName', () => {
  it('inserts the suffix before the extension, preserving folders', () => {
    expect(conflictCopyName('A.md', '3f2a')).toBe('A (conflict 3f2a).md');
    expect(conflictCopyName('notes/deep/A.md', 'x')).toBe('notes/deep/A (conflict x).md');
    expect(conflictCopyName('A.md B.md', 'x')).toBe('A.md B (conflict x).md');
  });
});

describe('local operations', () => {
  it('status/commitAll/log/fileAtCommit round-trip', async () => {
    const c0 = await initRepo({ 'a.md': 'hello\n' });
    expect(await status(dir)).toEqual([]);
    await put('a.md', 'hello world\n');
    await put('b.md', 'new\n');
    expect((await status(dir)).sort()).toEqual(['a.md', 'b.md']);
    const { committed, oid } = await commitAll(dir, 'edit', author);
    expect(committed).toBe(true);
    expect(await status(dir)).toEqual([]);
    const history = await log(dir, { limit: 10 });
    expect(history.map((c) => c.message)).toEqual(['edit', 'base']);
    // Old content is still recoverable at the base commit.
    expect(await fileAtCommit(dir, c0, 'a.md')).toBe('hello\n');
    expect(await fileAtCommit(dir, oid!, 'a.md')).toBe('hello world\n');
    expect(await fileAtCommit(dir, c0, 'b.md')).toBeNull();
  });

  it('commitAll is a no-op when nothing changed', async () => {
    await initRepo({ 'a.md': 'x\n' });
    expect(await commitAll(dir, 'again', author)).toEqual({ committed: false });
  });
});

describe('merge', () => {
  it('reports up-to-date when origin equals HEAD', async () => {
    const c0 = await initRepo({ 'a.md': 'x\n' });
    await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/main', value: c0, force: true });
    expect(await merge(dir, { conflictSuffix: 's', author })).toEqual({
      result: 'up-to-date',
      conflictCopies: [],
    });
  });

  it('fast-forwards when local is an ancestor of remote', async () => {
    const c0 = await initRepo({ 'a.md': 'x\n' });
    // Remote adds a file on top of C0; local stays at C0.
    await diverge(c0, {}, { 'b.md': 'remote\n' });
    // diverge left an "ours" commit; redo without local changes for a true FF:
    await git.checkout({ fs, dir, ref: c0, force: true });
    await git.writeRef({ fs, dir, ref: 'refs/heads/main', value: c0, force: true });
    await git.checkout({ fs, dir, ref: 'main', force: true });
    const out = await merge(dir, { conflictSuffix: 's', author });
    expect(out.result).toBe('fast-forward');
    expect(await read('b.md')).toBe('remote\n');
    expect(await status(dir)).toEqual([]);
  });

  it('cleanly merges edits to different files', async () => {
    const c0 = await initRepo({ 'a.md': 'base-a\n', 'b.md': 'base-b\n' });
    await diverge(c0, { 'a.md': 'ours-a\n' }, { 'b.md': 'theirs-b\n' });
    const out = await merge(dir, { conflictSuffix: 's', author });
    expect(out.result).toBe('merged');
    expect(out.conflictCopies).toEqual([]);
    expect(await read('a.md')).toBe('ours-a\n'); // our edit kept
    expect(await read('b.md')).toBe('theirs-b\n'); // their edit pulled in
    expect(await status(dir)).toEqual([]);
    // The merge commit has both parents.
    const head = await git.log({ fs, dir, depth: 1 });
    expect(head[0].commit.parent).toHaveLength(2);
  });

  it('keeps BOTH versions when the same file changed on both sides', async () => {
    const c0 = await initRepo({ 'note.md': 'base\n' });
    await diverge(c0, { 'note.md': 'LOCAL\n' }, { 'note.md': 'REMOTE\n' });
    const out = await merge(dir, { conflictSuffix: 'ab12', author });
    expect(out.result).toBe('conflicts');
    expect(out.conflictCopies).toEqual(['note (conflict ab12).md']);
    // Remote wins the original name; local is preserved, not lost.
    expect(await read('note.md')).toBe('REMOTE\n');
    expect(await read('note (conflict ab12).md')).toBe('LOCAL\n');
    expect(await status(dir)).toEqual([]);
  });

  it('does not lose an UNCOMMITTED local edit present at merge time', async () => {
    // Regression: an autosave can write to disk after sync's commitAll but before
    // merge (fetch is slow; the push-retry loop re-enters merge without
    // re-committing). merge force-checkouts the tree, so a stray edit must be
    // captured first or it is silently reverted to HEAD with no conflict copy.
    const c0 = await initRepo({ 'note.md': 'base\n' });
    // Remote advances the same file, off a detached base so main stays at c0.
    await git.checkout({ fs, dir, ref: c0, force: true });
    await put('note.md', 'REMOTE\n');
    const t = await commitAll(dir, 'theirs', author);
    await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/main', value: t.oid!, force: true });
    // Back on main at c0; simulate an autosave landing on disk, uncommitted.
    await git.checkout({ fs, dir, ref: 'main', force: true });
    await put('note.md', 'LOCAL\n');
    expect(await status(dir)).toEqual(['note.md']); // dirty going into the merge

    const out = await merge(dir, { conflictSuffix: 'race', author });
    expect(out.result).toBe('conflicts');
    expect(out.conflictCopies).toEqual(['note (conflict race).md']);
    expect(await read('note.md')).toBe('REMOTE\n'); // remote wins the name
    expect(await read('note (conflict race).md')).toBe('LOCAL\n'); // stray edit preserved
    expect(await status(dir)).toEqual([]); // clean after
  });

  it('preserves a locally-modified file that remote deleted', async () => {
    const c0 = await initRepo({ 'note.md': 'base\n' });
    await diverge(c0, { 'note.md': 'LOCAL\n' }, { 'note.md': null });
    const out = await merge(dir, { conflictSuffix: 'z9', author });
    expect(out.result).toBe('conflicts');
    expect(out.conflictCopies).toEqual(['note (conflict z9).md']);
    expect(existsSync(path.join(dir, 'note.md'))).toBe(false); // remote's deletion wins the name
    expect(await read('note (conflict z9).md')).toBe('LOCAL\n'); // local kept
    expect(await status(dir)).toEqual([]);
  });

});

describe('assertNoSymlinkOnPath (write-through-symlink guard)', () => {
  it('rejects a path whose leading component is a symlink', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'outside-'));
    await symlink(outside, path.join(dir, 'link'));
    await expect(assertNoSymlinkOnPath(dir, 'link/evil.md')).rejects.toThrow(/symlink/i);
    await rm(outside, { recursive: true, force: true });
  });

  it('rejects a symlinked leaf', async () => {
    await writeFile(path.join(dir, 'real.md'), 'x\n');
    await symlink(path.join(dir, 'real.md'), path.join(dir, 'aliased.md'));
    await expect(assertNoSymlinkOnPath(dir, 'aliased.md')).rejects.toThrow(/symlink/i);
  });

  it('allows a normal not-yet-existing path', async () => {
    await expect(assertNoSymlinkOnPath(dir, 'sub/new.md')).resolves.toBeUndefined();
  });
});
