import { syncService } from './sync';
import { vaultService } from './vault';

// Wire the edit signal without creating a module cycle.
vaultService.onEdited = () => syncService.notifyEdit();

export { syncService, useSync, type SyncPhase } from './sync';
export { vaultService, useVault, type NoteMeta, type SearchHit } from './vault';
export { useSettings, DEFAULT_SETTINGS, type Settings } from './settings';
