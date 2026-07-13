import { App as CapApp } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useEffect, useRef, useState } from 'react';
import { getGitEngine, isNativePlatform, setVaultDir } from '@/engine';
import {
  activeVaultIsLocal,
  captureSharedItems,
  syncService,
  useSettings,
  vaultService,
} from '@/services';
import { currentScreen, openNote, useNav } from '@/state/nav';
import { usePaneSizes } from '@/state/paneSizes';
import { PaneResizers } from '@/ui/workspace/PaneResizers';
import { installGlobalHotkeys } from '@/services/hotkeys';
import { Banners } from '@/ui/components/Banners';
import { OnboardingScreen } from '@/ui/screens/OnboardingScreen';
import { BottomPill } from '@/ui/workspace/BottomPill';
import { HoverPreviewCard } from '@/ui/components/HoverPreview';
import { DesktopChrome } from '@/ui/workspace/DesktopChrome';
import { DrawerGestures } from '@/ui/workspace/DrawerGestures';
import { OverlayHost } from '@/ui/workspace/OverlayHost';
import { Ribbon } from '@/ui/workspace/Ribbon';
import { RightSidebar } from '@/ui/workspace/RightSidebar';
import { Sidebar } from '@/ui/workspace/Sidebar';
import { SplitPane } from '@/ui/workspace/SplitPane';
import { StatusBar as DesktopStatusBar } from '@/ui/workspace/StatusBar';
import { WorkspaceScreen } from '@/ui/workspace/WorkspaceScreen';
import { useIsDesktop } from '@/ui/hooks/useIsDesktop';
import './styles/tokens.css';
import './styles/app.css';
import './styles/markdown.css';

type Boot = 'loading' | 'onboarding' | 'ready';

export function App() {
  const [boot, setBoot] = useState<Boot>('loading');
  const nav = useNav();
  const sidebarOpen = useNav((s) => s.sidebarOpen);
  const rightSidebarOpen = useNav((s) => s.rightSidebarOpen);
  const isDesktop = useIsDesktop();
  const theme = useSettings((s) => s.settings.theme);
  const fontScale = useSettings((s) => s.settings.fontScale);

  // Desktop docks both sidebars as columns; phone shows one overlay at a time.
  // Flag nav so its panel/navigation logic stops the mobile "close the other"
  // behavior, and dock both panels open on entry (Obsidian desktop's default).
  useEffect(() => {
    const nav = useNav.getState();
    nav.setDesktop(isDesktop);
    nav.setOverlay('none'); // no bottom-pill overlays in docked mode
    if (isDesktop) {
      useNav.setState({ sidebarOpen: true, rightSidebarOpen: true });
    } else {
      useNav.setState({ sidebarOpen: false, rightSidebarOpen: false });
    }
  }, [isDesktop]);

  // Dragged pane sizes land as CSS variables on the shell, written outside
  // React so a divider drag never re-renders the workspace tree. Cleared when
  // leaving desktop so the stylesheet defaults rule the phone layout.
  const shellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = shellRef.current;
    if (!el || !isDesktop) return;
    const apply = (s: { sidebarW: number; rightbarW: number; splitRatio: number }) => {
      el.style.setProperty('--sidebar-w', `${s.sidebarW}px`);
      el.style.setProperty('--rightbar-w', `${s.rightbarW}px`);
      // Consumed only under [data-split] (see app.css): a lone fr factor < 1
      // would otherwise leave free space unfilled when no split is open.
      el.style.setProperty('--main-fr-split', `${s.splitRatio}fr`);
      el.style.setProperty('--split-fr', `${1 - s.splitRatio}fr`);
    };
    apply(usePaneSizes.getState());
    const unsub = usePaneSizes.subscribe(apply);
    return () => {
      unsub();
      for (const p of ['--sidebar-w', '--rightbar-w', '--main-fr-split', '--split-fr']) {
        el.style.removeProperty(p);
      }
    };
  }, [isDesktop, boot]);

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

      // Local-only folder vaults (desktop) have no repo to find — the vault is
      // valid if its files load. A vanished folder falls back to onboarding.
      const localVault = activeVaultIsLocal(settings);
      if (settings.setupComplete && (info.exists || localVault)) {
        try {
          await vaultService.initialize();
          syncService.applySettings();
          setBoot('ready');
          void syncService.onAppActive();
          const shared = await captureSharedItems();
          if (shared) openNote(shared);
        } catch {
          setBoot('onboarding');
        }
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

  // Global keyboard shortcuts (desktop): command palette, quick switcher, nav,
  // etc. Installed once for the app's lifetime — commands/hotkeys read fresh
  // state on every keydown, so this effect never needs to re-run.
  useEffect(() => installGlobalHotkeys(), []);

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
    !isDesktop && // desktop navigates via the tab strip + keyboard, not the pill
    (screen.name === 'empty' ||
      screen.name === 'note' ||
      screen.name === 'edit' ||
      screen.name === 'artifact') &&
    !nav.editorFocused; // typing: the format toolbar takes the pill's place

  return (
    <div
      ref={shellRef}
      className="shell"
      data-desktop={isDesktop || undefined}
      data-left={isDesktop && sidebarOpen ? '' : undefined}
      data-right={isDesktop && rightSidebarOpen ? '' : undefined}
      data-split={isDesktop && nav.split !== null ? '' : undefined}
      onMouseDownCapture={(e) => {
        // Focus follows the clicked pane (Obsidian's active pane): the pane a
        // mousedown lands in receives the subsequent action's navigation.
        // Sidebar/chrome clicks leave focus alone, so tree rows keep opening
        // in the last-active pane. No-op without a split (incl. all of mobile).
        if (nav.split === null) return;
        const el = e.target as HTMLElement;
        const pane = el.closest('.split-pane')
          ? 'split'
          : el.closest('.screen')
            ? 'main'
            : null;
        if (pane !== null && pane !== nav.focusedPane) nav.setFocusedPane(pane);
      }}
    >
      {isDesktop && <Ribbon />}
      {isDesktop && <DesktopChrome />}
      <WorkspaceScreen screen={screen} />
      {isDesktop && nav.split !== null && <SplitPane />}
      {isDesktop && <DesktopStatusBar />}
      {isDesktop && <HoverPreviewCard />}
      <div className="banners-layer">
        <Banners />
      </div>
      <OverlayHost />
      {showPill && <BottomPill />}
      <SidebarLayer open={sidebarOpen} />
      <RightSidebar open={rightSidebarOpen} />
      {isDesktop && <PaneResizers />}
      {!isDesktop && <DrawerGestures />}
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

