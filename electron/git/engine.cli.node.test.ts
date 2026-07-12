// @vitest-environment node
/**
 * The CLI-git network path (external "opened folder" vaults): fetch and push
 * shell out to the system git so the user's own credentials apply. These tests
 * exercise that path against a file:// "remote" — a bare repo on disk — which
 * needs no credentials at all, so they run anywhere system git exists (and
 * skip, loudly, where it doesn't).
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitAll, configAuthor, fetch, hasSystemGit, merge, push } from './engine';

const execFileP = promisify(execFile);
const sh = (cwd: string, ...args: string[]) => execFileP('git', ['-C', cwd, ...args]);

const author = { name: 'Tester', email: 'test@basalt.app' };
// preferCli with no stored credentials: if the CLI path were NOT taken, the
// isomorphic fallback would throw "No git credentials configured" — so green
// tests prove the CLI really carried the traffic.
const cliCtx = { auth: () => null, preferCli: true };

let root: string;
let remote: string;
let work: string;
let other: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'basalt-cli-'));
  remote = path.join(root, 'remote.git');
  work = path.join(root, 'work');
  other = path.join(root, 'other');
  await execFileP('git', ['init', '--bare', '-b', 'main', remote]);
  await execFileP('git', ['clone', remote, work]);
  await sh(work, 'config', 'user.name', 'CLI User');
  await sh(work, 'config', 'user.email', 'cli@example.com');
  await writeFile(path.join(work, 'note.md'), 'hello\n');
  await sh(work, 'add', '.');
  await sh(work, 'commit', '-m', 'init');
  await sh(work, 'push', 'origin', 'main');
  await execFileP('git', ['clone', remote, other]);
  await sh(other, 'config', 'user.name', 'Other');
  await sh(other, 'config', 'user.email', 'other@example.com');
});

afterEach(() => rm(root, { recursive: true, force: true }));

describe('system git network ops (external vaults)', () => {
  it('system git is available on this machine', async () => {
    expect(await hasSystemGit()).toBe(true);
  });

  it('push publishes local commits over the CLI', async () => {
    await writeFile(path.join(work, 'note.md'), 'hello again\n');
    await commitAll(work, 'edit', author);
    const res = await push(work, cliCtx);
    expect(res).toEqual({ ok: true, rejected: false });
    const { stdout } = await sh(remote, 'log', '--format=%s', 'main');
    expect(stdout).toContain('edit');
  });

  it('fetch sees remote commits and reports behind, merge applies them', async () => {
    await writeFile(path.join(other, 'from-other.md'), 'elsewhere\n');
    await sh(other, 'add', '.');
    await sh(other, 'commit', '-m', 'remote edit');
    await sh(other, 'push', 'origin', 'main');

    const { ahead, behind } = await fetch(work, cliCtx);
    expect(ahead).toBe(0);
    expect(behind).toBe(1);
    const outcome = await merge(work, { conflictSuffix: 'test', author });
    expect(outcome.result).toBe('fast-forward');
  });

  it('push reports a rejected non-fast-forward so sync can pull and retry', async () => {
    await writeFile(path.join(other, 'note.md'), 'other side\n');
    await sh(other, 'add', '.');
    await sh(other, 'commit', '-m', 'race');
    await sh(other, 'push', 'origin', 'main');

    await writeFile(path.join(work, 'note.md'), 'our side\n');
    await commitAll(work, 'ours', author);
    const res = await push(work, cliCtx);
    expect(res.ok).toBe(false);
    expect(res.rejected).toBe(true);
  });

  it('configAuthor reads the repo commit identity for external vaults', async () => {
    const cfg = await configAuthor(work);
    expect(cfg).toEqual({ name: 'CLI User', email: 'cli@example.com' });
  });
});
