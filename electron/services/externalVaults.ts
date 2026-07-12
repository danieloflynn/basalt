/**
 * Registry of EXTERNAL vault folders — directories outside the app's managed
 * `userData/vaults` sandbox that the user explicitly opened via the native
 * folder picker ("Open a folder as vault"). The registry is the security
 * boundary: main only performs fs/git operations on a dir the renderer names
 * if it is a managed vault child OR an exact registry entry, so a compromised
 * renderer can never point the privileged bridge at an arbitrary path — only
 * at folders a real user picked in a real dialog at some point.
 *
 * Electron-free on purpose (paths in, paths out) so the resolution rules are
 * unit-testable in plain Node.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

/** Load the persisted registry (absolute realpaths). Missing/corrupt → empty. */
export async function loadRegistry(file: string): Promise<string[]> {
  try {
    const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
    return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveRegistry(file: string, dirs: string[]): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(dirs, null, 2));
}

/** Add a folder (already realpath'd by the picker). Idempotent. */
export function addExternal(registry: string[], realDir: string): string[] {
  return registry.includes(realDir) ? registry : [...registry, realDir];
}

export function removeExternal(registry: string[], realDir: string): string[] {
  return registry.filter((d) => d !== realDir);
}

/**
 * Resolve a renderer-supplied vault dir to the absolute working-tree root, or
 * throw. Two legal shapes, nothing else:
 *  - a RELATIVE name → a strict child of the managed vaults base (rejects `..`
 *    escapes and the base itself, whose recursive delete would wipe all vaults);
 *  - an ABSOLUTE path → an EXACT registry entry (normalized). Subpaths of a
 *    registered root are rejected too: the renderer only ever names vault
 *    roots, so anything else is a bug or an escape attempt.
 */
export function resolveVaultRoot(
  managedBase: string,
  registry: string[],
  dir: string,
): { root: string; external: boolean } {
  if (path.isAbsolute(dir)) {
    const norm = path.resolve(dir);
    if (registry.includes(norm)) return { root: norm, external: true };
    throw new Error(`Not an opened vault folder: ${dir}`);
  }
  const abs = path.resolve(managedBase, dir);
  if (!abs.startsWith(managedBase + path.sep)) {
    throw new Error(`Invalid vault directory: ${dir}`);
  }
  return { root: abs, external: false };
}
