// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addExternal,
  loadRegistry,
  removeExternal,
  resolveVaultRoot,
  saveRegistry,
} from './externalVaults';

const BASE = path.sep + path.join('data', 'vaults');

describe('resolveVaultRoot', () => {
  it('resolves managed names to strict children of the base', () => {
    expect(resolveVaultRoot(BASE, [], 'vault')).toEqual({
      root: path.join(BASE, 'vault'),
      external: false,
    });
    expect(resolveVaultRoot(BASE, [], 'vault-2')).toEqual({
      root: path.join(BASE, 'vault-2'),
      external: false,
    });
  });

  it('rejects traversal out of the managed base, and the base itself', () => {
    // The base itself: a recursive delete there would wipe every vault.
    expect(() => resolveVaultRoot(BASE, [], '')).toThrow();
    expect(() => resolveVaultRoot(BASE, [], '.')).toThrow();
    expect(() => resolveVaultRoot(BASE, [], '..')).toThrow();
    expect(() => resolveVaultRoot(BASE, [], 'vault/../..')).toThrow();
    expect(() => resolveVaultRoot(BASE, [], '../outside')).toThrow();
  });

  it('resolves registered external folders, exactly', () => {
    const home = path.sep + path.join('home', 'me', 'Notes');
    expect(resolveVaultRoot(BASE, [home], home)).toEqual({ root: home, external: true });
    // Normalized forms of the same folder still match…
    expect(resolveVaultRoot(BASE, [home], home + path.sep).root).toBe(home);
    // …but unregistered paths, subpaths, and parents do not.
    expect(() => resolveVaultRoot(BASE, [home], path.sep + 'home')).toThrow();
    expect(() => resolveVaultRoot(BASE, [home], path.join(home, 'sub'))).toThrow();
    expect(() => resolveVaultRoot(BASE, [], home)).toThrow();
  });

  it('rejects absolute paths that normalize to unregistered locations', () => {
    const home = path.sep + path.join('home', 'me', 'Notes');
    const sneaky = path.join(home, '..', '..', 'other', 'secrets');
    expect(() => resolveVaultRoot(BASE, [home], sneaky)).toThrow();
    // ..-normalization cannot fabricate a registry hit either way around.
    const viaTraversal = path.join(home, 'x', '..'); // normalizes back to home
    expect(resolveVaultRoot(BASE, [home], viaTraversal).root).toBe(home);
  });
});

describe('registry persistence', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'basalt-ext-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('round-trips, dedupes, and removes', async () => {
    const file = path.join(dir, 'sub', 'external-vaults.json');
    expect(await loadRegistry(file)).toEqual([]); // missing → empty

    let reg = addExternal([], '/home/me/Notes');
    reg = addExternal(reg, '/home/me/Notes'); // idempotent
    reg = addExternal(reg, '/home/me/Work');
    await saveRegistry(file, reg);
    expect(await loadRegistry(file)).toEqual(['/home/me/Notes', '/home/me/Work']);

    await saveRegistry(file, removeExternal(reg, '/home/me/Notes'));
    expect(await loadRegistry(file)).toEqual(['/home/me/Work']);
  });

  it('treats corrupt registry files as empty instead of crashing', async () => {
    const file = path.join(dir, 'external-vaults.json');
    await saveRegistry(file, []);
    await rm(file);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, '{not json');
    expect(await loadRegistry(file)).toEqual([]);
    await writeFile(file, '{"a":1}'); // valid JSON, wrong shape
    expect(await loadRegistry(file)).toEqual([]);
    await writeFile(file, '["/ok", 5, null]'); // mixed types filtered
    expect(await loadRegistry(file)).toEqual(['/ok']);
  });
});
