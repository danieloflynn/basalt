import { App as CapApp } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useEffect, useState } from 'react';
import { getGitEngine, isNativePlatform, VAULT_DIR } from '@/engine';
import { syncService, useSettings, vaultService } from '@/services';
import { currentScreen, useNav } from '@/state/nav';
import { BrowserScreen } from '@/ui/screens/BrowserScreen';
import { EditScreen } from '@/ui/screens/EditScreen';
import { HistoryScreen } from '@/ui/screens/HistoryScreen';
import { NoteScreen } from '@/ui/screens/NoteScreen';
import { OnboardingScreen } from '@/ui/screens/OnboardingScreen';
import { SearchScreen } from '@/ui/screens/SearchScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import './styles/tokens.css';
import './styles/app.css';
import './styles/markdown.css';

type Boot = 'loading' | 'onboarding' | 'ready';

export function App() {
  const [boot, setBoot] = useState<Boot>('loading');
  const stack = useNav((s) => s.stack);
  const theme = useSettings((s) => s.settings.theme);
  const fontScale = useSettings((s) => s.settings.fontScale);

  // Boot: load settings, decide onboarding vs vault.
  useEffect(() => {
    void (async () => {
      await useSettings.getState().load();
      const { settings } = useSettings.getState();
      const info = await getGitEngine()
        .repoInfo({ dir: VAULT_DIR })
        .catch(() => ({ exists: false }));

      if (settings.setupComplete && info.exists) {
        await vaultService.initialize();
        syncService.applySettings();
        setBoot('ready');
        void syncService.onAppActive();
      } else {
        setBoot('onboarding');
      }
    })();
  }, []);

  // Theme: reflect setting + system preference onto <html> (P-1).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const resolved = theme === 'system' ? (mq.matches ? 'light' : 'dark') : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.setProperty('--font-scale', String(fontScale));
      if (isNativePlatform) {
        void StatusBar.setStyle({
          style: resolved === 'dark' ? Style.Dark : Style.Light,
        }).catch(() => undefined);
        void StatusBar.setBackgroundColor({
          color: resolved === 'dark' ? '#131215' : '#f1f0ee',
        }).catch(() => undefined);
      }
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, fontScale]);

  // Android hardware/gesture back (P-6).
  useEffect(() => {
    if (!isNativePlatform) return;
    const sub = CapApp.addListener('backButton', () => {
      const wentBack = useNav.getState().back();
      if (!wentBack) void CapApp.minimizeApp();
    });
    return () => {
      void sub.then((s) => s.remove());
    };
  }, []);

  // Sync on resume (SY-5); keyboard: keep layout stable.
  useEffect(() => {
    if (!isNativePlatform) return;
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && boot === 'ready') void syncService.onAppActive();
    });
    void Keyboard.setScroll({ isDisabled: true }).catch(() => undefined);
    return () => {
      void sub.then((s) => s.remove());
    };
  }, [boot]);

  if (boot === 'loading') {
    return <div className="shell" />;
  }

  if (boot === 'onboarding') {
    return (
      <div className="shell">
        <OnboardingScreen onDone={() => setBoot('ready')} />
      </div>
    );
  }

  const screen = currentScreen(stack);
  switch (screen.name) {
    case 'browser':
      return <BrowserScreen key={screen.folder} folder={screen.folder} />;
    case 'note':
      return (
        <div className="shell">
          <NoteScreen key={screen.path} path={screen.path} />
        </div>
      );
    case 'edit':
      return (
        <div className="shell">
          <EditScreen key={screen.path} path={screen.path} />
        </div>
      );
    case 'search':
      return (
        <div className="shell">
          <SearchScreen initialQuery={screen.initialQuery} />
        </div>
      );
    case 'settings':
      return (
        <div className="shell">
          <SettingsScreen />
        </div>
      );
    case 'history':
      return (
        <div className="shell">
          <HistoryScreen path={screen.path} />
        </div>
      );
  }
}
