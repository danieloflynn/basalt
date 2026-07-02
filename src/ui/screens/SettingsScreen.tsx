import { useState } from 'react';
import { getGitEngine, VAULT_DIR } from '@/engine';
import { syncService, useSettings, useSync } from '@/services';
import { useNav } from '@/state/nav';
import { timeAgo } from '@/ui/components/SyncStatus';
import { Dialog } from '@/ui/components/Dialog';
import { IconBack, IconChevronRight, IconGit, IconHistory } from '@/ui/icons';

export function SettingsScreen() {
  const nav = useNav();
  const { settings, update, reset } = useSettings();
  const { lastSyncAt, pendingCount } = useSync();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [editingToken, setEditingToken] = useState(false);

  return (
    <div className="screen">
      <header className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={() => nav.back()}>
          <IconBack />
        </button>
        <h1 className="topbar__title">Settings</h1>
      </header>

      <div className="scroll">
        <div className="group">
          <p className="group__label">Vault</p>
          <div className="card">
            <div className="setting">
              <span className="row__icon">
                <IconGit size={20} />
              </span>
              <div className="setting__body">
                <p className="setting__label">{repoShortName(settings.repoUrl)}</p>
                <p className="setting__desc">
                  Branch {settings.branch ?? 'main'} ·{' '}
                  {lastSyncAt ? `synced ${timeAgo(lastSyncAt)}` : 'not synced yet'}
                  {pendingCount > 0 ? ` · ${pendingCount} pending` : ''}
                </p>
              </div>
            </div>
            <button className="setting" onClick={() => nav.push({ name: 'history' })}>
              <span className="row__icon">
                <IconHistory size={20} />
              </span>
              <div className="setting__body">
                <p className="setting__label">Vault history</p>
                <p className="setting__desc">Recent commits, from every device</p>
              </div>
              <IconChevronRight size={18} style={{ color: 'var(--text-faint)' }} />
            </button>
            <button className="setting" onClick={() => setEditingToken(true)}>
              <div className="setting__body">
                <p className="setting__label">Update access token</p>
                <p className="setting__desc">Replace the GitHub token when it expires</p>
              </div>
            </button>
          </div>
        </div>

        <div className="group">
          <p className="group__label">Sync</p>
          <div className="card">
            <ToggleSetting
              label="Sync when app opens"
              desc="Pull the latest changes on launch"
              value={settings.autoSyncOnLaunch}
              onChange={(v) => void update({ autoSyncOnLaunch: v })}
            />
            <ChoiceSetting
              label="After editing"
              options={[
                { label: 'Sync soon', value: 30 },
                { label: 'Sync later', value: 300 },
                { label: 'Manual', value: null },
              ]}
              value={settings.autoPushDebounceSec}
              desc={
                settings.autoPushDebounceSec === null
                  ? 'Changes wait until you tap sync'
                  : `Changes push ~${settings.autoPushDebounceSec === 30 ? '30 seconds' : '5 minutes'} after you stop typing`
              }
              onChange={(v) => {
                void update({ autoPushDebounceSec: v });
              }}
            />
            <ChoiceSetting
              label="Background pull"
              options={[
                { label: '15 min', value: 15 },
                { label: 'Hourly', value: 60 },
                { label: 'Off', value: null },
              ]}
              value={settings.syncIntervalMin}
              desc="Check for remote changes while the app is open"
              onChange={(v) => {
                void update({ syncIntervalMin: v }).then(() => syncService.applySettings());
              }}
            />
          </div>
        </div>

        <div className="group">
          <p className="group__label">Appearance</p>
          <div className="card">
            <ChoiceSetting
              label="Theme"
              options={[
                { label: 'System', value: 'system' as const },
                { label: 'Dark', value: 'dark' as const },
                { label: 'Light', value: 'light' as const },
              ]}
              value={settings.theme}
              onChange={(v) => void update({ theme: v })}
            />
            <ChoiceSetting
              label="Reading size"
              options={[
                { label: 'Cozy', value: 0.94 },
                { label: 'Default', value: 1 },
                { label: 'Large', value: 1.12 },
              ]}
              value={settings.fontScale}
              onChange={(v) => void update({ fontScale: v })}
            />
          </div>
        </div>

        <div className="group">
          <p className="group__label">Danger zone</p>
          <div className="card">
            <button className="setting" onClick={() => setConfirmDisconnect(true)}>
              <div className="setting__body">
                <p className="setting__label" style={{ color: 'var(--danger)' }}>
                  Disconnect vault
                </p>
                <p className="setting__desc">
                  Removes the vault and token from this phone. The repository on GitHub is
                  untouched.
                </p>
              </div>
            </button>
          </div>
        </div>

        <p
          style={{
            textAlign: 'center',
            color: 'var(--text-faint)',
            fontSize: 'var(--text-xs)',
            padding: '26px 0 10px',
            fontFamily: 'var(--font-display)',
          }}
        >
          Basalt · plain files, no lock-in
        </p>
      </div>

      {editingToken && (
        <Dialog
          title="Update access token"
          placeholder="github_pat_…"
          confirmLabel="Save"
          onCancel={() => setEditingToken(false)}
          onConfirm={async (token) => {
            if (token.trim()) {
              await getGitEngine().setCredentials({
                username: settings.username,
                token: token.trim(),
              });
            }
            setEditingToken(false);
          }}
        />
      )}

      {confirmDisconnect && (
        <Dialog
          title="Disconnect vault?"
          message="Un-synced local changes will be lost. Everything already pushed is safe on GitHub."
          confirmLabel="Disconnect"
          danger
          onCancel={() => setConfirmDisconnect(false)}
          onConfirm={async () => {
            const engine = getGitEngine();
            await engine.deleteRepo({ dir: VAULT_DIR });
            await engine.clearCredentials();
            await reset();
            setConfirmDisconnect(false);
            nav.reset();
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}

function repoShortName(url: string | null): string {
  if (!url) return 'No repository';
  const m = /([^/:]+\/[^/]+?)(\.git)?$/.exec(url);
  return m ? m[1] : url;
}

function ToggleSetting({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="setting">
      <div className="setting__body">
        <p className="setting__label">{label}</p>
        {desc && <p className="setting__desc">{desc}</p>}
      </div>
      <button
        className="toggle"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
      />
    </div>
  );
}

function ChoiceSetting<T>({
  label,
  desc,
  options,
  value,
  onChange,
}: {
  label: string;
  desc?: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="setting" style={{ flexWrap: 'wrap', gap: 8 }}>
      <div className="setting__body" style={{ flexBasis: '100%' }}>
        <p className="setting__label">{label}</p>
        {desc && <p className="setting__desc">{desc}</p>}
      </div>
      <div className="segments" style={{ flexBasis: '100%' }}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            aria-pressed={Object.is(o.value, value)}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
