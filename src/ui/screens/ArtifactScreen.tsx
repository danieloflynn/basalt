import { useEffect, useState } from 'react';
import { noteTitle } from '@/lib/paths';
import { vaultService } from '@/services';
import { ArtifactFrame } from '@/ui/components/ArtifactFrame';
import { IconSync } from '@/ui/icons';
import { SidebarToggle } from '@/ui/workspace/chrome';
import { usePullDown } from '@/ui/hooks/usePullDown';
import { useNav } from '@/state/nav';

/**
 * Viewer for HTML artifacts (.html/.htm files in the vault). The document is
 * inlined via srcdoc into a sandboxed iframe with no same-origin access, so
 * artifact scripts run freely but can't reach the app, the Capacitor bridge,
 * or vault storage. Purely a viewer — the file on disk stays the source of
 * truth and syncs like any other vault file.
 */
export function ArtifactScreen({ path }: { path: string }) {
  const nav = useNav();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the reload button: re-reads the file and remounts the frame.
  const [generation, setGeneration] = useState(0);
  const pullRef = usePullDown<HTMLDivElement>(() => nav.setOverlay('quickopen'));

  useEffect(() => {
    let cancelled = false;
    setError(null);
    vaultService
      .readFileFresh(path)
      .then((t) => {
        if (!cancelled) setHtml(t);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path, generation]);

  return (
    <div className="screen">
      <header className="workspace-top" ref={pullRef}>
        <SidebarToggle />
        <span className="workspace-top__status" style={{ flex: 1, textAlign: 'center' }}>
          {noteTitle(path)}
        </span>
        <div className="workspace-top__group">
          <button
            className="iconbtn"
            aria-label="Reload artifact"
            onClick={() => setGeneration((g) => g + 1)}
          >
            <IconSync size={20} />
          </button>
        </div>
      </header>

      {error !== null && (
        <div className="state">
          <p className="state__title">Couldn't open this artifact</p>
          <p className="state__hint">{error}</p>
        </div>
      )}
      {error === null && html === null && <div className="state" />}
      {error === null && html !== null && (
        <ArtifactFrame key={generation} path={path} html={html} className="artifact-frame" />
      )}
    </div>
  );
}
