import { useEffect, useState } from 'react';
import { getGitEngine, vaultDir, type CommitInfo } from '@/engine';
import { noteTitle } from '@/lib/paths';
import { useNav } from '@/state/nav';
import { IconBack, IconChevronRight } from '@/ui/icons';

/** Git history, whole vault or a single note; per-note commits open a diff (D-4). */
export function HistoryScreen({ path }: { path?: string }) {
  const nav = useNav();
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getGitEngine()
      .log({ dir: vaultDir(), limit: 100, path })
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
      <header className="workspace-top">
        <button className="iconbtn workspace-top__group" aria-label="Back" onClick={() => nav.back()}>
          <IconBack size={20} />
        </button>
        <span className="workspace-top__status">
          {path ? `History · ${noteTitle(path)}` : 'Vault history'}
        </span>
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
        {commits?.map((c) =>
          path ? (
            <button
              key={c.oid}
              className="commit"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() =>
                nav.push({ name: 'noteVersion', path, oid: c.oid, when: c.when })
              }
            >
              <div className="commit__dot" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="commit__msg">{c.message}</p>
                <p className="commit__meta">
                  {c.authorName} · {formatWhen(c.when)} · {c.oid.slice(0, 7)}
                </p>
              </div>
              <IconChevronRight size={16} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
            </button>
          ) : (
            <div className="commit" key={c.oid}>
              <div className="commit__dot" />
              <div>
                <p className="commit__msg">{c.message}</p>
                <p className="commit__meta">
                  {c.authorName} · {formatWhen(c.when)} · {c.oid.slice(0, 7)}
                </p>
              </div>
            </div>
          ),
        )}
        {path && commits && commits.length > 0 && (
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', padding: '12px 4px' }}>
            Select a commit to see that version and restore it.
          </p>
        )}
      </div>
    </div>
  );
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
