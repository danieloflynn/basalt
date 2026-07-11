import { Capacitor } from '@capacitor/core';
import { DesktopGitEngine, DesktopVaultFS } from './desktop';
import { MemoryVaultFS, MockGitEngine } from './mock';
import { NativeGitEngine, NativeVaultFS } from './native';
import type { GitEngine, VaultFS } from './types';

export * from './types';

/** Default subdirectory of the app's data dir holding the git working tree. */
export const VAULT_DIR = 'vault';

export const isNativePlatform = Capacitor.isNativePlatform();

/**
 * The Electron desktop shell (Basalt for Mac). Detected by the preload-injected
 * `window.basalt` bridge, NOT Capacitor — Electron reports as a non-native web
 * platform, so this must be checked before the native/mock split below.
 */
export const isDesktopPlatform = typeof window !== 'undefined' && !!window.basalt;

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
  engine ??= isDesktopPlatform
    ? new DesktopGitEngine()
    : isNativePlatform
      ? new NativeGitEngine()
      : new MockGitEngine();
  return engine;
}

export function getVaultFS(): VaultFS {
  vaultFS ??= isDesktopPlatform
    ? new DesktopVaultFS(activeDir)
    : isNativePlatform
      ? new NativeVaultFS(activeDir)
      : new MemoryVaultFS();
  return vaultFS;
}

/** Open a vault file with an external app (PDF viewer etc.). */
export async function openFileExternally(path: string): Promise<void> {
  if (isDesktopPlatform) {
    await window.basalt!.openExternal(activeDir, path);
  } else if (isNativePlatform) {
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
