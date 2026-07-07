import { useEffect, useState } from 'react';
import { getGitEngine, setVaultDir } from '@/engine';
import { syncService, useSettings, useSync, vaultService, type VaultInfo } from '@/services';
import { useNav } from '@/state/nav';
import { timeAgo } from '@/ui/components/SyncStatus';
import { Dialog } from '@/ui/components/Dialog';
import { OnboardingScreen } from '@/ui/screens/OnboardingScreen';
import { IconBack, IconChevronRight, IconGit, IconHistory, IconPlus } from '@/ui/icons';

export function SettingsScreen() {
  const nav = useNav();
  const { settings, update, reset } = useSettings();
  const { lastSyncAt, pendingCount } = useSync();
  const [removing, setRemoving] = useState<VaultInfo | null>(null);
  const [editingToken, setEditingToken] = useState(false);
  const [addingVault, setAddingVault] = useState(false);

  if (addingVault) {
    return (
      <div className="screen">
        <OnboardingScreen
          mode="add"
          onDone={() => {
            setAddingVault(false);
            nav.reset();
          }}
          onCancel={() => setAddingVault(false)}
        />
      </div>
    );
  }

  const switchVault = async (vault: VaultInfo) => {
    if (vault.dir === settings.activeVault) return;
    await update({
      activeVault: vault.dir,
      repoUrl: vault.repoUrl,
      branch: vault.branch,
      username: vault.username,
    });
    setVaultDir(vault.dir);
    nav.reset();
    await vaultService.initialize();
    void syncService.syncNow('vault-switch');
  };

  return (
    <div className="screen">
      <header className="workspace-top">
        <button className="iconbtn workspace-top__group" aria-label="Back" onClick={() => nav.back()}>
          <IconBack size={20} />
        </button>
        <span className="workspace-top__status">Settings</span>
      </header>

      <div className="scroll">
        <div className="group">
          <p className="group__label">Vaults</p>
          <div className="card">
            {settings.vaults.map((v) => (
              <div className="setting" key={v.dir}>
                <span className="row__icon">
                  <IconGit size={20} />
                </span>
                <button className="setting__body" style={{ textAlign: 'left' }} onClick={() => void switchVault(v)}>
                  <p className="setting__label">
                    {v.name}
                    {v.dir === settings.activeVault && (
                      <span style={{ color: 'var(--ember)', fontSize: 'var(--text-xs)' }}> · active</span>
                    )}
                  </p>
                  <p className="setting__desc">
                    {v.repoUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')} · {v.branch}
                    {v.dir === settings.activeVault && lastSyncAt
                      ? ` · synced ${timeAgo(lastSyncAt)}${pendingCount > 0 ? ` · ${pendingCount} pending` : ''}`
                      : ''}
                  </p>
                </button>
                <button
                  className="banner__action"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => setRemoving(v)}
                >
                  Remove
                </button>
              </div>
            ))}
            <button className="setting" onClick={() => setAddingVault(true)}>
              <span className="row__icon">
                <IconPlus size={20} />
              </span>
              <div className="setting__body">
                <p className="setting__label">Add vault</p>
                <p className="setting__desc">Clone another repository to this phone</p>
              </div>
            </button>
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
          <p className="group__label">Editor</p>
          <div className="card">
            <ChoiceSetting
              label="Default editing mode"
              desc="Live preview hides markdown syntax except on the line you're editing"
              options={[
                { label: 'Live preview', value: 'live' as const },
                { label: 'Source', value: 'source' as const },
              ]}
              value={settings.editorMode}
              onChange={(v) => void update({ editorMode: v })}
            />
            <ToggleSetting
              label="Move checked items down"
              desc="Checking off a task moves it below the unchecked items in its list"
              value={settings.sortCheckedToBottom}
              onChange={(v) => void update({ sortCheckedToBottom: v })}
            />
          </div>
        </div>

        <div className="group">
          <p className="group__label">Templates</p>
          <div className="card">
            <TextSetting
              label="Template folder location"
              desc="Where your template notes live. The command palette's Insert template and New note from template actions list the markdown notes in this folder."
              value={settings.templateFolder}
              placeholder="templates"
              onCommit={(v) => void update({ templateFolder: v.trim() })}
            />
          </div>
        </div>

        <div className="group">
          <p className="group__label">New notes</p>
          <div className="card">
            <ChoiceSetting
              label="Default location for new notes"
              desc="Where a note lands when it's created without a folder — the bottom-bar New note button and the quick switcher's Create action."
              options={[
                { label: 'Vault root', value: 'root' as const },
                { label: 'Folder', value: 'folder' as const },
              ]}
              value={settings.newNoteLocation}
              onChange={(v) => void update({ newNoteLocation: v })}
            />
            {settings.newNoteLocation === 'folder' && (
              <TextSetting
                label="New note folder"
                desc="Vault-relative folder, e.g. Daily or Inbox. Leave blank for the vault root."
                value={settings.newNoteFolderPath}
                placeholder="Inbox"
                onCommit={(v) => void update({ newNoteFolderPath: v.trim() })}
              />
            )}
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

        <p
          style={{
            textAlign: 'center',
            color: 'var(--text-faint)',
            fontSize: 'var(--text-xs)',
            padding: '26px 0 110px',
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

      {removing && (
        <Dialog
          title={`Remove "${removing.name}"?`}
          message="Un-synced local changes in this vault will be lost. Everything already pushed is safe on GitHub."
          confirmLabel="Remove"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const vault = removing;
            setRemoving(null);
            const engine = getGitEngine();
            await engine.deleteRepo({ dir: vault.dir });
            const remaining = settings.vaults.filter((v) => v.dir !== vault.dir);
            if (remaining.length === 0) {
              await engine.clearCredentials();
              await reset();
              window.location.reload();
              return;
            }
            const next = remaining[0];
            await update({
              vaults: remaining,
              activeVault: next.dir,
              repoUrl: next.repoUrl,
              branch: next.branch,
              username: next.username,
            });
            if (vault.dir === settings.activeVault) {
              setVaultDir(next.dir);
              nav.reset();
              await vaultService.initialize();
            }
          }}
        />
      )}
    </div>
  );
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

function TextSetting({
  label,
  desc,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  desc?: string;
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  // Local draft so typing doesn't churn the store / re-persist every keystroke;
  // commit on blur or Enter. Re-seed when the persisted value changes elsewhere.
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <div className="setting" style={{ flexWrap: 'wrap', gap: 8 }}>
      <div className="setting__body" style={{ flexBasis: '100%' }}>
        <p className="setting__label">{label}</p>
        {desc && <p className="setting__desc">{desc}</p>}
      </div>
      <input
        className="dialog__input"
        style={{ flexBasis: '100%' }}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
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
