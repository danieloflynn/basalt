import { consumePendingShares } from '@/engine';
import { syncService } from './sync';
import { formatDate, vaultService } from './vault';

// Wire the edit signal without creating a module cycle.
vaultService.onEdited = () => syncService.notifyEdit();

export { syncService, useSync, type SyncPhase } from './sync';
export {
  vaultService,
  useVault,
  formatDate,
  type NoteMeta,
  type SearchHit,
  type Backlink,
} from './vault';
export {
  useSettings,
  DEFAULT_SETTINGS,
  activeVaultIsLocal,
  type Settings,
  type VaultInfo,
} from './settings';

/**
 * Drain text shared into Basalt from other apps (Android share sheet) into
 * Inbox notes. Returns the path of the last created note, if any.
 */
export async function captureSharedItems(): Promise<string | null> {
  const items = await consumePendingShares();
  let lastPath: string | null = null;
  for (const item of items) {
    const fallback = `Shared ${formatDate('YYYY-MM-DD HH.mm', new Date())}`;
    const name = (item.subject?.trim() || fallback).slice(0, 80);
    const path = await vaultService.createNote('Inbox', name);
    await vaultService.writeNote(path, `${item.text.trim()}\n`);
    lastPath = path;
  }
  return lastPath;
}
