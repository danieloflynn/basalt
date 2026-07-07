import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';
import { DEFAULT_GRAPH_CONFIG, type GraphConfig } from '@/ui/graph/config';

export interface Settings {
  // Vault / connection
  repoUrl: string | null;
  branch: string | null;
  /** GitHub username — used for HTTPS auth and commit identity. */
  username: string;
  setupComplete: boolean;

  // Sync behaviour (SY-6)
  autoSyncOnLaunch: boolean;
  /** Seconds of edit-quiet before an auto sync; null = manual sync only. */
  autoPushDebounceSec: number | null;
  /** Periodic background pull, in minutes; null = off. */
  syncIntervalMin: number | null;
  authorName: string;
  authorEmail: string;

  // Appearance (P-1, P-7)
  theme: 'system' | 'dark' | 'light';
  fontScale: number;

  // Editor
  editorMode: 'live' | 'source';
  /** Sticky default view for opened notes (the app's default-view setting). */
  defaultView: 'reading' | 'editing';
  /** Checking a task moves it below its unchecked siblings (reading view + live preview taps). */
  sortCheckedToBottom: boolean;

  // Templates
  /** Vault-relative folder holding template notes (blank falls back to `templates`). */
  templateFolder: string;

  // New notes
  /** Where a note created without an explicit folder lands. */
  newNoteLocation: 'root' | 'folder';
  /** Target folder when newNoteLocation === 'folder' (vault-relative). */
  newNoteFolderPath: string;

  // Files
  sortOrder: 'name' | 'modified';

  // Graph view (filters, groups, display, forces — one persisted blob).
  graph: GraphConfig;

  // Multi-vault (ST-6). Each vault is a git working tree in its own dir.
  vaults: VaultInfo[];
  activeVault: string;
}

export interface VaultInfo {
  dir: string;
  name: string;
  repoUrl: string;
  branch: string;
  username: string;
}

export const DEFAULT_SETTINGS: Settings = {
  repoUrl: null,
  branch: null,
  username: '',
  setupComplete: false,
  autoSyncOnLaunch: true,
  autoPushDebounceSec: 30,
  syncIntervalMin: 15,
  authorName: 'Basalt',
  authorEmail: 'basalt@localhost',
  theme: 'system',
  fontScale: 1,
  editorMode: 'live',
  defaultView: 'reading',
  sortCheckedToBottom: true,
  templateFolder: 'templates',
  newNoteLocation: 'root',
  newNoteFolderPath: '',
  sortOrder: 'name',
  graph: DEFAULT_GRAPH_CONFIG,
  vaults: [],
  activeVault: 'vault',
};

const STORAGE_KEY = 'basalt.settings';

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
  reset: () => Promise<void>;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (value) {
      try {
        const settings: Settings = { ...DEFAULT_SETTINGS, ...JSON.parse(value) };
        // Migrate single-vault installs to the vault registry.
        if (settings.setupComplete && settings.vaults.length === 0 && settings.repoUrl) {
          settings.vaults = [
            {
              dir: 'vault',
              name: settings.repoUrl.replace(/\.git$/, '').split('/').slice(-1)[0] ?? 'Vault',
              repoUrl: settings.repoUrl,
              branch: settings.branch ?? 'main',
              username: settings.username,
            },
          ];
          settings.activeVault = 'vault';
        }
        set({ settings, loaded: true });
        return;
      } catch {
        // fall through to defaults
      }
    }
    set({ loaded: true });
  },

  update: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(settings) });
  },

  reset: async () => {
    set({ settings: DEFAULT_SETTINGS });
    await Preferences.remove({ key: STORAGE_KEY });
  },
}));
