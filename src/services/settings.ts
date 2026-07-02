import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';

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
        set({ settings: { ...DEFAULT_SETTINGS, ...JSON.parse(value) }, loaded: true });
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
