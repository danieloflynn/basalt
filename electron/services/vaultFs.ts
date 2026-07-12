/**
 * Desktop VaultFS backend — the working-tree file access behind the renderer's
 * VaultFS interface, on plain Node fs. Electron-free: every call takes the
 * ABSOLUTE vault directory (main resolves it from the vault name) plus a
 * vault-relative, forward-slash path. main.ts wraps these over IPC.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { VaultFileInfo } from '../../src/engine/types';

/** Resolve a vault-relative path, refusing anything that escapes the vault. */
function safeJoin(absDir: string, rel: string): string {
  const abs = path.resolve(absDir, rel);
  if (abs !== absDir && !abs.startsWith(absDir + path.sep)) {
    throw new Error(`path escapes vault: ${rel}`);
  }
  return abs;
}

const toPosix = (p: string) => p.split(path.sep).join('/');

/** Recursively list working-tree files (git metadata excluded). */
export async function list(absDir: string): Promise<VaultFileInfo[]> {
  const out: VaultFileInfo[] = [];
  async function walk(rel: string): Promise<void> {
    let entries;
    try {
      entries = await fsp.readdir(path.join(absDir, rel), { withFileTypes: true });
    } catch {
      return; // vault dir not created yet
    }
    for (const e of entries) {
      if (e.name === '.git') continue; // never surface git internals as vault files
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(childRel);
      } else if (e.isFile()) {
        const st = await fsp.stat(path.join(absDir, childRel));
        out.push({ path: toPosix(childRel), mtimeMs: st.mtimeMs, size: st.size });
      }
    }
  }
  await walk('');
  return out;
}

export function read(absDir: string, rel: string): Promise<string> {
  return fsp.readFile(safeJoin(absDir, rel), 'utf8');
}

export async function readMany(absDir: string, rels: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    rels.map(async (rel) => {
      try {
        out[rel] = await fsp.readFile(safeJoin(absDir, rel), 'utf8');
      } catch {
        // Skip files that vanished between listing and reading.
      }
    }),
  );
  return out;
}

export async function write(absDir: string, rel: string, text: string): Promise<void> {
  const abs = safeJoin(absDir, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, text, 'utf8');
}

export async function writeBinary(absDir: string, rel: string, base64: string): Promise<void> {
  const abs = safeJoin(absDir, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, Buffer.from(base64, 'base64'));
}

export async function remove(absDir: string, rel: string): Promise<void> {
  await fsp.rm(safeJoin(absDir, rel), { force: true });
}

export async function rename(absDir: string, from: string, to: string): Promise<void> {
  const dest = safeJoin(absDir, to);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.rename(safeJoin(absDir, from), dest);
}

export async function mkdir(absDir: string, rel: string): Promise<void> {
  await fsp.mkdir(safeJoin(absDir, rel), { recursive: true });
}

export async function rmdir(absDir: string, rel: string): Promise<void> {
  await fsp.rm(safeJoin(absDir, rel), { recursive: true, force: true });
}
