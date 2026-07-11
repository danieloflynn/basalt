import { create } from 'zustand';
import { getGitEngine, vaultDir, type Author, type GitProgress } from '@/engine';
import { deviceNoun } from '@/lib/device';
import { useSettings } from './settings';
import { vaultService } from './vault';

export type SyncPhase =
  | 'idle'
  | 'committing'
  | 'pulling'
  | 'pushing'
  | 'offline'
  | 'error';

export interface SyncState {
  phase: SyncPhase;
  /** Local changes not yet known to be pushed. */
  pendingCount: number;
  lastSyncAt: number | null;
  error: string | null;
  /** Conflict copies created by merges, until the user dismisses the notice. */
  conflictCopies: string[];
  progress: GitProgress | null;
}

export const useSync = create<SyncState>(() => ({
  phase: 'idle',
  pendingCount: 0,
  lastSyncAt: null,
  error: null,
  conflictCopies: [],
  progress: null,
}));

const PUSH_RETRIES = 3;

/**
 * Drives the GitEngine through explicit states (TD-15). Offline-first: edits
 * always commit locally; pull/push happen when the network allows (SY-2).
 */
export class SyncService {
  private engine = getGitEngine();
  private syncing = false;
  private queued = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.engine.onProgress((p) => useSync.setState({ progress: p }));
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        const { phase, pendingCount } = useSync.getState();
        if (phase === 'offline' || pendingCount > 0) void this.syncNow('back-online');
      });
    }
  }

  /** Called by VaultService after every local content change. */
  notifyEdit(): void {
    useSync.setState((s) => ({ pendingCount: s.pendingCount + 1 }));
    const { autoPushDebounceSec } = useSettings.getState().settings;
    if (autoPushDebounceSec === null) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(
      () => void this.syncNow('auto-edit'),
      Math.max(2, autoPushDebounceSec) * 1000,
    );
  }

  applySettings(): void {
    const { syncIntervalMin } = useSettings.getState().settings;
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalTimer = null;
    if (syncIntervalMin) {
      this.intervalTimer = setInterval(
        () => void this.syncNow('interval'),
        syncIntervalMin * 60_000,
      );
    }
  }

  dismissConflicts(): void {
    useSync.setState({ conflictCopies: [] });
  }

  private author(): Author {
    const { authorName, authorEmail, username } = useSettings.getState().settings;
    return {
      name: authorName || username || 'Basalt',
      email:
        authorEmail !== 'basalt@localhost'
          ? authorEmail
          : username
            ? `${username}@users.noreply.github.com`
            : 'basalt@localhost',
    };
  }

  private stamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /**
   * Full cycle: commit → fetch → merge → push (with bounded retry when the
   * remote moved underneath us). Any real conflict produces conflict copies —
   * never lost data (TD-20).
   */
  async syncNow(reason: string): Promise<void> {
    if (this.syncing) {
      this.queued = true;
      return;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.syncing = true;
    const dir = vaultDir();
    const author = this.author();

    try {
      useSync.setState({ error: null, progress: null, phase: 'committing' });
      await this.engine.commitAll({
        dir,
        message: `vault: ${deviceNoun()} edits — ${this.stamp()} (${reason})`,
        author,
      });

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        // Edits are safely committed locally; try the network part later.
        useSync.setState({ phase: 'offline' });
        return;
      }

      useSync.setState({ phase: 'pulling' });
      let pulledSomething = false;
      for (let attempt = 0; ; attempt++) {
        await this.engine.fetch({ dir });
        const merge = await this.engine.merge({
          dir,
          conflictSuffix: `from ${deviceNoun()} ${this.stamp().replace(':', '.')}`,
          author,
        });
        if (merge.result !== 'up-to-date') pulledSomething = true;
        if (merge.conflictCopies.length > 0) {
          useSync.setState((s) => ({
            conflictCopies: [...s.conflictCopies, ...merge.conflictCopies],
          }));
        }

        useSync.setState({ phase: 'pushing' });
        const push = await this.engine.push({ dir });
        if (push.ok) break;
        if (!push.rejected || attempt >= PUSH_RETRIES) {
          throw new Error(push.message ?? 'Push failed');
        }
        // Remote moved while we were merging — pull again and retry.
        useSync.setState({ phase: 'pulling' });
      }

      if (pulledSomething) await vaultService.initialize();

      const { dirty } = await this.engine.status({ dir });
      useSync.setState({
        phase: 'idle',
        pendingCount: dirty.length,
        lastSyncAt: Date.now(),
        progress: null,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const offline = /offline|unable to resolve host|unknownhost/i.test(message);
      useSync.setState({
        phase: offline ? 'offline' : 'error',
        error: offline ? null : message,
        progress: null,
      });
    } finally {
      this.syncing = false;
      if (this.queued) {
        this.queued = false;
        void this.syncNow('queued');
      }
    }
  }

  /** App start / resume (SY-5). */
  async onAppActive(): Promise<void> {
    const { settings } = useSettings.getState();
    if (settings.setupComplete && settings.autoSyncOnLaunch) {
      await this.syncNow('launch');
    }
  }
}

export const syncService = new SyncService();
