import { useEffect, useState } from 'react';
import { getGitEngine, VAULT_DIR, type CommitInfo } from '@/engine';
import { noteTitle } from '@/lib/paths';
import { useNav } from '@/state/nav';
import { IconBack } from '@/ui/icons';

/** Git history, whole vault or a single note (D-4). */
export function HistoryScreen({ path }: { path?: string }) {
  const nav = useNav();
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getGitEngine()
      .log({ dir: VAULT_DIR, limit: 100, path })
      .then((c) => {
        if (!cancelled) setCommits(c);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div className="screen">
      <header className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={() => nav.back()}>
          <IconBack />
        </button>
        <h1 className="topbar__title">
          History
          {path && <span className="topbar__subtitle">{noteTitle(path)}</span>}
        </h1>
      </header>

      <div className="scroll" style={{ padding: '4px var(--pad-screen)' }}>
        {error && (
          <div className="state">
            <p className="state__title">Couldn't load history</p>
            <p className="state__hint">{error}</p>
          </div>
        )}
        {!error && commits === null && <div className="state" />}
        {commits?.length === 0 && (
          <div className="state">
            <p className="state__hint">No commits touch this note yet.</p>
          </div>
        )}
        {commits?.map((c) => (
          <div className="commit" key={c.oid}>
            <div className="commit__dot" />
            <div>
              <p className="commit__msg">{c.message}</p>
              <p className="commit__meta">
                {c.authorName} · {formatWhen(c.when)} · {c.oid.slice(0, 7)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatWhen(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
