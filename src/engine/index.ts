import { Capacitor } from '@capacitor/core';
import { MemoryVaultFS, MockGitEngine } from './mock';
import { NativeGitEngine, NativeVaultFS } from './native';
import type { GitEngine, VaultFS } from './types';

export * from './types';

/** Subdirectory of the app's data dir holding the git working tree. */
export const VAULT_DIR = 'vault';

export const isNativePlatform = Capacitor.isNativePlatform();

let engine: GitEngine | undefined;
let vaultFS: VaultFS | undefined;

export function getGitEngine(): GitEngine {
  engine ??= isNativePlatform ? new NativeGitEngine() : new MockGitEngine();
  return engine;
}

export function getVaultFS(): VaultFS {
  vaultFS ??= isNativePlatform ? new NativeVaultFS(VAULT_DIR) : new MemoryVaultFS();
  return vaultFS;
}
