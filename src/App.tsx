import { App as CapApp } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { StatusBar, Style } from '@capacitor/status-bar';
import { lazy, Suspense, useEffect, useState } from 'react';
import { getGitEngine, isNativePlatform, setVaultDir } from '@/engine';
import {
  captureSharedItems,
  syncService,
  useSettings,
  vaultService,
} from '@/services';
import { currentScreen, openNote, useNav, type Screen } from '@/state/nav';
import { Banners } from '@/ui/components/Banners';
import { IconCalendar, IconNotePlus } from '@/ui/icons';
import { GraphScreen } from '@/ui/screens/GraphScreen';
import { HistoryScreen } from '@/ui/screens/HistoryScreen';
import { NoteScreen } from '@/ui/screens/NoteScreen';
import { NoteVersionScreen } from '@/ui/screens/NoteVersionScreen';
import { OnboardingScreen } from '@/ui/screens/OnboardingScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { BottomPill } from '@/ui/workspace/BottomPill';
import { SidebarToggle } from '@/ui/workspace/chrome';
import { DrawerGestures } from '@/ui/workspace/DrawerGestures';
import { Sidebar } from '@/ui/workspace/Sidebar';
import { usePullDown } from '@/ui/hooks/usePullDown';
import './styles/tokens.css';
import './styles/app.css';
import './styles/markdown.css';

// CodeMirror is the heaviest chunk — load it only when editing starts (P-4).
const EditScreen = lazy(() =>
  import('@/ui/screens/EditScreen').then((m) => ({ default: m.EditScreen })),
);

type Boot = 'loading' | 'onboarding' | 'ready';

export function App() {
  const [boot, setBoot] = useState<Boot>('loading');
  const nav = useNav();
  const sidebarOpen = useNav((s) => s.sidebarOpen);
  const theme = useSettings((s) => s.settings.theme);
  const fontScale = useSettings((s) => s.settings.fontScale);

  // Boot: load settings, decide onboarding vs vault.
  useEffect(() => {
    void (async () => {
      await useSettings.getState().load();
      const { settings } = useSettings.getState();
      setVaultDir(settings.activeVault);
      // Sticky view mode persists like Obsidian's default-view setting.
      useNav.getState().setViewMode(settings.defaultView);
      const info = await getGitEngine()
        .repoInfo({ dir: settings.activeVault })
        .catch(() => ({ exists: false }));

      if (settings.setupComplete && info.exists) {
        await vaultService.initialize();
        syncService.applySettings();
        setBoot('ready');
        void syncService.onAppActive();
        const shared = await captureSharedItems();
        if (shared) openNote(shared);
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

  // Sync + shared-text capture on resume (SY-5); stable keyboard layout.
  useEffect(() => {
    if (!isNativePlatform) return;
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && boot === 'ready') {
        void syncService.onAppActive();
        void captureSharedItems().then((path) => {
          if (path) openNote(path);
        });
      }
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
        <OnboardingScreen mode="first" onDone={() => setBoot('ready')} />
      </div>
    );
  }

  const screen = currentScreen(nav);
  const showPill =
    (screen.name === 'empty' || screen.name === 'note' || screen.name === 'edit') &&
    !nav.editorFocused; // typing: the format toolbar takes the pill's place

  return (
    <div className="shell">
      <WorkspaceScreen screen={screen} />
      <div className="banners-layer">
        <Banners />
      </div>
      {showPill && <BottomPill />}
      <SidebarLayer open={sidebarOpen} />
      <DrawerGestures />
    </div>
  );
}

/**
 * The drawer stays mounted so swipe gestures can scrub it and the close
 * transition can play; `data-open` drives the CSS open/close transition,
 * gestures drive it inline mid-drag.
 */
function SidebarLayer({ open }: { open: boolean }) {
  const nav = useNav();
  return (
    <>
      <div
        className="scrim scrim--sidebar"
        data-open={open || undefined}
        onClick={() => nav.closeSidebar()}
      />
      <Sidebar open={open} />
    </>
  );
}

function WorkspaceScreen({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case 'empty':
      return <EmptyView />;
    case 'note':
      return <NoteScreen key={screen.path} path={screen.path} heading={screen.heading} />;
    case 'edit':
      return (
        <Suspense fallback={<div className="screen" />}>
          <EditScreen key={screen.path} path={screen.path} />
        </Suspense>
      );
    case 'settings':
      return <SettingsScreen />;
    case 'history':
      return <HistoryScreen path={screen.path} />;
    case 'noteVersion':
      return (
        <NoteVersionScreen path={screen.path} oid={screen.oid} when={screen.when} />
      );
    case 'graph':
      return <GraphScreen path={screen.path} />;
  }
}

/** "No file is open" — Obsidian's empty state, Basalt-flavored. */
function EmptyView() {
  const nav = useNav();
  const pullRef = usePullDown<HTMLDivElement>(() => nav.setOverlay('quickopen'));
  return (
    <div className="screen" ref={pullRef}>
      <header className="workspace-top">
        <SidebarToggle />
      </header>
      <div className="state" style={{ justifyContent: 'center' }}>
        <div className="columns-hero" aria-hidden="true">
          <div className="col" />
          <div className="col" />
          <div className="col" />
          <div className="col" />
          <div className="col" />
        </div>
        <p className="state__title">No note is open</p>
        <p className="state__hint">Browse the vault from the top-left, or start writing.</p>
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button
            className="btn btn--ghost"
            style={{ border: '1px solid var(--border)' }}
            onClick={async () => {
              const path = await vaultService.openDailyNote();
              nav.push({ name: 'note', path });
            }}
          >
            <IconCalendar size={18} /> Today
          </button>
          <button
            className="btn btn--primary"
            onClick={async () => {
              const path = await vaultService.createNote('', 'Untitled');
              nav.push({ name: 'edit', path });
            }}
          >
            <IconNotePlus size={18} /> New note
          </button>
        </div>
      </div>
    </div>
  );
}
