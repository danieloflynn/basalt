import { useState } from 'react';
import { setVaultDir } from '@/engine';
import { syncService, useSettings, vaultService } from '@/services';
import { useNav } from '@/state/nav';
import { IconPlus } from '@/ui/icons';
import { OnboardingScreen } from '@/ui/screens/OnboardingScreen';

/** Vault switcher popup (mirrors Obsidian's "Manage vaults…" menu). */
export function VaultMenu({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettings();
  const [adding, setAdding] = useState(false);

  if (adding) {
    return (
      <div className="vault-add-overlay">
        <OnboardingScreen
          mode="add"
          onDone={() => {
            setAdding(false);
            onClose();
          }}
          onCancel={() => setAdding(false)}
        />
      </div>
    );
  }

  const switchTo = async (dir: string) => {
    if (dir === settings.activeVault) {
      onClose();
      return;
    }
    const vault = settings.vaults.find((v) => v.dir === dir);
    await update({
      activeVault: dir,
      repoUrl: vault?.repoUrl ?? null,
      branch: vault?.branch ?? null,
      username: vault?.username ?? settings.username,
    });
    setVaultDir(dir);
    useNav.getState().reset();
    onClose();
    await vaultService.initialize();
    void syncService.syncNow('vault-switch');
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="vault-menu">
        {settings.vaults.map((v) => (
          <button key={v.dir} className="vault-menu__item" onClick={() => void switchTo(v.dir)}>
            {v.name}
            <span
              className="vault-menu__radio"
              data-checked={v.dir === settings.activeVault}
              aria-hidden="true"
            />
          </button>
        ))}
        <button className="vault-menu__item" onClick={() => setAdding(true)}>
          Add vault…
          <span className="vault-menu__action" aria-hidden="true">
            <IconPlus size={20} />
          </span>
        </button>
      </div>
    </>
  );
}
