import { useEffect, useRef, useState } from 'react';
import { pickVaultFolder, setVaultDir, type RepoInfo } from '@/engine';
import { syncService, useSettings, vaultService } from '@/services';
import { useNav } from '@/state/nav';
import { IconBack, IconChevronRight } from '@/ui/icons';

type Picked = { dir: string; name: string; repo: RepoInfo };

/**
 * Desktop-only "Open a folder as vault" flow. Launches the native folder
 * picker, then — when the folder is already a git clone with a remote — offers
 * the choice between git syncing (through the system git CLI, so the user's
 * own ssh keys / credential helpers apply) and plain local editing. Folders
 * without a repo or remote open as local vaults: Basalt never runs `git init`
 * on a folder behind the user's back.
 */
export function OpenFolderVault({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const launched = useRef(false);

  useEffect(() => {
    // React 18 StrictMode double-mounts effects in dev; one dialog only.
    if (launched.current) return;
    launched.current = true;
    void pickVaultFolder()
      .then((res) => (res === null ? onCancel() : setPicked(res)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (mode: 'git' | 'local') => {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { settings, update } = useSettings.getState();
      const vault = {
        dir: picked.dir,
        name: picked.name,
        repoUrl: picked.repo.url ?? '',
        branch: picked.repo.branch ?? 'main',
        username: settings.username,
        mode,
      };
      await update({
        setupComplete: true,
        repoUrl: picked.repo.url ?? null,
        branch: picked.repo.branch ?? null,
        // Re-opening the same folder replaces its entry instead of duplicating.
        vaults: [...settings.vaults.filter((v) => v.dir !== picked.dir), vault],
        activeVault: picked.dir,
      });
      setVaultDir(picked.dir);
      useNav.getState().reset();
      await vaultService.initialize();
      syncService.applySettings();
      if (mode === 'git') void syncService.syncNow('vault-open');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const canGitSync = picked !== null && picked.repo.exists && !!picked.repo.url;

  return (
    <div className="screen" style={{ padding: 'var(--safe-top) 0 var(--safe-bottom)' }}>
      <header className="topbar" style={{ borderBottom: 'none' }}>
        <button className="iconbtn" aria-label="Back" onClick={onCancel}>
          <IconBack />
        </button>
        <h1 className="topbar__title">Open folder as vault</h1>
      </header>

      <div className="scroll" style={{ padding: '4px var(--pad-screen)' }}>
        {error && (
          <div className="banner banner--error" style={{ margin: '14px 0 0' }} role="alert">
            <div className="banner__body">{error}</div>
          </div>
        )}

        {picked === null && !error && (
          <p className="state__hint" style={{ marginTop: 24 }}>
            Choose a folder in the file dialog…
          </p>
        )}

        {picked !== null && (
          <>
            <p
              style={{
                marginTop: 16,
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
                lineHeight: 1.5,
                overflowWrap: 'anywhere',
              }}
            >
              <strong style={{ color: 'var(--text)' }}>{picked.name}</strong>
              <br />
              {picked.dir}
            </p>

            {canGitSync ? (
              <div className="rowlist" style={{ marginTop: 18 }}>
                <button className="row row--card" disabled={busy} onClick={() => void open('git')}>
                  <span className="row__body">
                    <span className="row__title" style={{ display: 'block' }}>
                      Sync with git
                    </span>
                    <span className="row__meta" style={{ display: 'block' }}>
                      Commit, pull and push {picked.repo.url} using your command-line git
                      credentials (ssh keys or credential helper).
                    </span>
                  </span>
                  <IconChevronRight size={18} className="row__chevron" />
                </button>
                <button
                  className="row row--card"
                  disabled={busy}
                  onClick={() => void open('local')}
                >
                  <span className="row__body">
                    <span className="row__title" style={{ display: 'block' }}>
                      Edit locally only
                    </span>
                    <span className="row__meta" style={{ display: 'block' }}>
                      Basalt reads and writes the files; git is never touched.
                    </span>
                  </span>
                  <IconChevronRight size={18} className="row__chevron" />
                </button>
              </div>
            ) : (
              <>
                <p
                  style={{
                    marginTop: 18,
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-faint)',
                    lineHeight: 1.55,
                  }}
                >
                  {picked.repo.exists
                    ? 'This repository has no remote, so it opens as a local vault — Basalt edits the files and leaves git alone.'
                    : 'This folder is not a git repository, so it opens as a local vault — your notes live as plain files, no syncing.'}
                </p>
                <button
                  className="btn btn--primary"
                  style={{ width: '100%', marginTop: 18 }}
                  disabled={busy}
                  onClick={() => void open('local')}
                >
                  {busy ? 'Opening…' : 'Open vault'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
