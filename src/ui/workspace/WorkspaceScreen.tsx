import { lazy, Suspense } from 'react';
import { vaultService } from '@/services';
import { useNav, type Screen } from '@/state/nav';
import { IconCalendar, IconNotePlus } from '@/ui/icons';
import { ArtifactScreen } from '@/ui/screens/ArtifactScreen';
import { GraphScreen } from '@/ui/screens/GraphScreen';
import { HistoryScreen } from '@/ui/screens/HistoryScreen';
import { NoteScreen } from '@/ui/screens/NoteScreen';
import { NoteVersionScreen } from '@/ui/screens/NoteVersionScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { defaultNewNoteFolder } from '@/ui/templates';
import { SidebarToggle } from '@/ui/workspace/chrome';
import { usePullDown } from '@/ui/hooks/usePullDown';

// CodeMirror is the heaviest chunk — load it only when editing starts (P-4).
const EditScreen = lazy(() =>
  import('@/ui/screens/EditScreen').then((m) => ({ default: m.EditScreen })),
);

/**
 * Renders one workspace screen. Used for the main pane (App) and, on
 * desktop, inside the split pane — which is why it lives outside App.tsx:
 * both mount points share the exact same screen switch.
 */
export function WorkspaceScreen({ screen }: { screen: Screen }) {
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
    case 'artifact':
      return <ArtifactScreen key={screen.path} path={screen.path} />;
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
              const path = await vaultService.createNote(defaultNewNoteFolder(), 'Untitled');
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
