import { Capacitor } from '@capacitor/core';
import { MemoryVaultFS, MockGitEngine } from './mock';
import { NativeGitEngine, NativeVaultFS } from './native';
import type { GitEngine, VaultFS } from './types';

export * from './types';

/** Default subdirectory of the app's data dir holding the git working tree. */
export const VAULT_DIR = 'vault';

export const isNativePlatform = Capacitor.isNativePlatform();

let engine: GitEngine | undefined;
let vaultFS: VaultFS | undefined;
let activeDir = VAULT_DIR;

/** Directory (relative to app data) of the currently active vault. */
export function vaultDir(): string {
  return activeDir;
}

/** Switch the active vault (multi-vault). Callers must re-initialize VaultService after. */
export function setVaultDir(dir: string): void {
  if (dir === activeDir) return;
  activeDir = dir;
  vaultFS = undefined;
}

export function getGitEngine(): GitEngine {
  engine ??= isNativePlatform ? new NativeGitEngine() : new MockGitEngine();
  return engine;
}

export function getVaultFS(): VaultFS {
  vaultFS ??= isNativePlatform ? new NativeVaultFS(activeDir) : new MemoryVaultFS();
  return vaultFS;
}

/** Open a vault file with an external app (PDF viewer etc.). */
export async function openFileExternally(path: string): Promise<void> {
  if (isNativePlatform) {
    const { nativeOpenFile } = await import('./native');
    await nativeOpenFile(activeDir, path);
  } else {
    const url = await getVaultFS().fileUrl(path);
    window.open(url, '_blank');
  }
}

/** Drain any text shared into the app via the Android share sheet. */
export async function consumePendingShares(): Promise<{ text: string; subject?: string }[]> {
  if (!isNativePlatform) return [];
  const { nativeConsumePendingShares } = await import('./native');
  return nativeConsumePendingShares();
}
