import { useState } from 'react';
import { getGitEngine, useSyncProgress } from '@/engine/hooks';
import { isDesktopPlatform, setVaultDir } from '@/engine';
import { syncService, useSettings, vaultService } from '@/services';
import { deviceNoun, keystoreName } from '@/lib/device';
import { IconBack, IconChevronRight } from '@/ui/icons';
import { OpenFolderVault } from '@/ui/screens/OpenFolderVault';

type Step = 'welcome' | 'connect' | 'branch' | 'cloning' | 'folder';

/**
 * Guided setup: repo URL + token -> validate & list branches -> pick branch
 * -> clone with live progress (ST-1..ST-5). mode="add" connects an extra
 * vault (ST-6) instead of the first one.
 */
export function OnboardingScreen({
  mode,
  onDone,
  onCancel,
}: {
  mode: 'first' | 'add';
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { settings, update } = useSettings();
  const [step, setStep] = useState<Step>(mode === 'first' ? 'welcome' : 'connect');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState('main');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Second vault: one PAT is shared across repos, so reuse the stored
  // username/token and only ask for the repository (with a per-repo access
  // reminder). An escape hatch reveals the full form to change credentials.
  const [useNewCreds, setUseNewCreds] = useState(false);
  const progress = useSyncProgress();

  const engine = getGitEngine();
  const reuseCreds = mode === 'add' && !useNewCreds;

  const validate = async () => {
    setBusy(true);
    setError(null);
    try {
      const cleanUrl = normalizeRepoUrl(url);
      // Reuse mode keeps the stored PAT; listRemoteBranches authenticates with
      // it (and surfaces a clear error if the token can't reach this repo).
      if (!reuseCreds) {
        await engine.setCredentials({ username: username.trim(), token: token.trim() });
      }
      const remote = await engine.listRemoteBranches({ url: cleanUrl });
      setUrl(cleanUrl);
      setBranches(remote.branches);
      setBranch(remote.defaultBranch ?? remote.branches[0] ?? 'main');
      setStep('branch');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const clone = async (chosen: string) => {
    setBranch(chosen);
    setStep('cloning');
    setError(null);
    try {
      const { settings } = useSettings.getState();
      const dir =
        mode === 'first' && settings.vaults.length === 0
          ? 'vault'
          : nextVaultDir(settings.vaults.map((v) => v.dir));
      const name = url.replace(/\.git$/, '').split('/').slice(-1)[0] || 'Vault';
      // Reuse mode inherits the account already stored for the other vault(s).
      const effectiveUser = reuseCreds ? settings.username : username.trim();

      await engine.clone({ url, dir, branch: chosen });
      await update({
        repoUrl: url,
        branch: chosen,
        username: effectiveUser,
        authorName: effectiveUser || 'Basalt',
        setupComplete: true,
        vaults: [
          ...settings.vaults,
          { dir, name, repoUrl: url, branch: chosen, username: effectiveUser },
        ],
        activeVault: dir,
      });
      setVaultDir(dir);
      await vaultService.initialize();
      syncService.applySettings();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('branch');
    }
  };

  if (step === 'folder') {
    return <OpenFolderVault onDone={onDone} onCancel={() => setStep('welcome')} />;
  }

  return (
    <div className="screen" style={{ padding: 'var(--safe-top) 0 var(--safe-bottom)' }}>
      {step === 'welcome' && (
        <div className="state" style={{ justifyContent: 'center', gap: 18 }}>
          <div className="columns-hero" aria-hidden="true">
            <div className="col" />
            <div className="col" />
            <div className="col" />
            <div className="col" />
            <div className="col" />
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 34,
              fontWeight: 580,
              color: 'var(--text)',
              letterSpacing: '0.01em',
            }}
          >
            Basalt
          </h1>
          <p className="state__hint" style={{ fontSize: 'var(--text-md)', maxWidth: 300 }}>
            Your notes, as plain markdown in a git repository. Read and write them here;
            they sync with GitHub and stay yours.
          </p>
          <button
            className="btn btn--primary"
            style={{ marginTop: 10, minWidth: 220 }}
            onClick={() => setStep('connect')}
          >
            Connect a repository
          </button>
          {isDesktopPlatform && (
            <button
              className="btn btn--ghost"
              style={{ minWidth: 220, border: '1px solid var(--border)' }}
              onClick={() => setStep('folder')}
            >
              Open a folder as vault
            </button>
          )}
        </div>
      )}

      {step === 'connect' && (
        <>
          <header className="topbar" style={{ borderBottom: 'none' }}>
            <button
              className="iconbtn"
              aria-label="Back"
              onClick={() => (mode === 'first' ? setStep('welcome') : onCancel?.())}
            >
              <IconBack />
            </button>
            <h1 className="topbar__title">
              {mode === 'first' ? 'Connect GitHub' : 'Add a vault'}
            </h1>
          </header>
          <div className="scroll" style={{ padding: '4px var(--pad-screen)' }}>
            <Field
              label="Repository"
              hint="Paste the repo URL or owner/name"
              value={url}
              onChange={setUrl}
              placeholder="danieloflynn/vault"
              type="url"
            />

            {reuseCreds ? (
              <p
                style={{
                  marginTop: 16,
                  padding: '12px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-faint)',
                  lineHeight: 1.55,
                }}
              >
                Using your saved account
                {settings.username ? ` (@${settings.username})` : ''} and access token. Make sure
                that token can reach this repository — fine-grained tokens grant access per
                repository, so you may need to add this repo under the token's Repository access on
                GitHub.{' '}
                <button
                  type="button"
                  onClick={() => setUseNewCreds(true)}
                  style={{
                    color: 'var(--link)',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    font: 'inherit',
                  }}
                >
                  Use a different account or token
                </button>
              </p>
            ) : (
              <>
                <Field
                  label="GitHub username"
                  hint={`Used for commits made from this ${deviceNoun()}`}
                  value={username}
                  onChange={setUsername}
                  placeholder="danieloflynn"
                />
                <Field
                  label="Access token"
                  hint="A fine-grained personal access token with read/write access to just this repository. GitHub → Settings → Developer settings → Fine-grained tokens."
                  value={token}
                  onChange={setToken}
                  placeholder="github_pat_…"
                  type="password"
                />
                {mode === 'add' && (
                  <p
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-faint)',
                      marginTop: 10,
                      lineHeight: 1.5,
                    }}
                  >
                    This replaces the token used for every vault on this {deviceNoun()}.
                  </p>
                )}
              </>
            )}

            {error && (
              <div className="banner banner--error" style={{ margin: '14px 0 0' }} role="alert">
                <div className="banner__body">{error}</div>
              </div>
            )}

            <button
              className="btn btn--primary"
              style={{ width: '100%', marginTop: 22 }}
              disabled={!url.trim() || (!reuseCreds && !token.trim()) || busy}
              onClick={() => void validate()}
            >
              {busy ? 'Checking…' : 'Continue'}
            </button>
            {!reuseCreds && (
              <p
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-faint)',
                  marginTop: 14,
                  lineHeight: 1.5,
                  textAlign: 'center',
                }}
              >
                The token is stored in {keystoreName()}, on this {deviceNoun()} only.
              </p>
            )}
          </div>
        </>
      )}

      {step === 'branch' && (
        <>
          <header className="topbar" style={{ borderBottom: 'none' }}>
            <button className="iconbtn" aria-label="Back" onClick={() => setStep('connect')}>
              <IconBack />
            </button>
            <h1 className="topbar__title">Choose a branch</h1>
          </header>
          <div className="scroll">
            {error && (
              <div className="banner banner--error" role="alert">
                <div className="banner__body">{error}</div>
              </div>
            )}
            <div className="rowlist">
              {branches.map((b) => (
                <button key={b} className="row row--card" onClick={() => void clone(b)}>
                  <span className="row__body">
                    <span className="row__title" style={{ display: 'block' }}>
                      {b}
                    </span>
                    {b === branch && (
                      <span className="row__meta" style={{ display: 'block' }}>
                        default
                      </span>
                    )}
                  </span>
                  <IconChevronRight size={18} className="row__chevron" />
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {step === 'cloning' && (
        <div className="state" style={{ justifyContent: 'center' }}>
          <div className="sync-columns" data-state="syncing" style={{ height: 40 }}>
            <div className="col" style={{ width: 9 }} />
            <div className="col" style={{ width: 9 }} />
            <div className="col" style={{ width: 9 }} />
            <div className="col" style={{ width: 9 }} />
          </div>
          <p className="state__title">Cloning your vault</p>
          <p className="state__hint">{progress?.phase ?? 'Contacting GitHub…'}</p>
          <div className="progressline" style={{ width: 220 }}>
            <div
              className={
                progress && progress.percent >= 0
                  ? 'progressline__fill'
                  : 'progressline__fill progressline__fill--indeterminate'
              }
              style={{ width: `${Math.max(4, progress?.percent ?? 0)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label style={{ display: 'block', marginTop: 18 }}>
      <span
        style={{
          display: 'block',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        {label}
      </span>
      <input
        className="dialog__input"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {hint && (
        <span
          style={{
            display: 'block',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-faint)',
            marginTop: 6,
            lineHeight: 1.5,
          }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

function nextVaultDir(existing: string[]): string {
  let n = existing.length + 1;
  while (existing.includes(`vault-${n}`)) n++;
  return `vault-${n}`;
}

/** Accept full URLs or shorthand "owner/repo"; always yield an HTTPS clone URL. */
export function normalizeRepoUrl(input: string): string {
  let s = input.trim();
  if (/^git@github\.com:/.test(s)) {
    s = s.replace(/^git@github\.com:/, 'https://github.com/');
  }
  if (!/^https?:\/\//i.test(s)) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(s)) {
      throw new Error('Enter a repository as owner/name or a full https URL.');
    }
    s = `https://github.com/${s}`;
  }
  if (!s.endsWith('.git')) s = `${s}.git`;
  return s;
}
