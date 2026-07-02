import { useCallback, useEffect, useState } from 'react';
import { parseFrontmatter } from '@/lib/frontmatter';
import { noteTitle } from '@/lib/paths';
import { vaultService } from '@/services';
import { useNav } from '@/state/nav';
import { IconBack, IconHistory, IconPencil } from '@/ui/icons';
import { Markdown } from '@/ui/markdown/Markdown';

export function NoteScreen({ path }: { path: string }) {
  const nav = useNav();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    vaultService
      .readNote(path)
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const toggleTask = useCallback(
    (line: number) => {
      if (text === null) return;
      const updated = toggleTaskAtLine(text, line);
      if (updated === null) return;
      setText(updated);
      void vaultService.writeNote(path, updated);
    },
    [text, path],
  );

  const fm = text !== null ? parseFrontmatter(text) : null;
  // Line positions in the rendered body are offset by the frontmatter block.
  const fmLineOffset =
    fm?.raw != null ? fm.raw.split('\n').length + 2 : 0;

  return (
    <div className="screen">
      <header className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={() => nav.back()}>
          <IconBack />
        </button>
        <h1 className="topbar__title">{noteTitle(path)}</h1>
        <button
          className="iconbtn"
          aria-label="Note history"
          onClick={() => nav.push({ name: 'history', path })}
        >
          <IconHistory />
        </button>
        <button
          className="iconbtn iconbtn--accent"
          aria-label="Edit note"
          onClick={() => nav.push({ name: 'edit', path })}
        >
          <IconPencil />
        </button>
      </header>

      <div className="scroll">
        {error !== null && (
          <div className="state">
            <p className="state__title">Couldn't open this note</p>
            <p className="state__hint">{error}</p>
          </div>
        )}
        {error === null && text === null && <div className="state" />}
        {fm !== null && (
          <>
            {Object.keys(fm.data).length > 0 && <Properties data={fm.data} />}
            <Markdown
              source={fm.body}
              path={path}
              onToggleTask={(line) => toggleTask(line + fmLineOffset)}
            />
          </>
        )}
      </div>
    </div>
  );
}

function Properties({ data }: { data: Record<string, unknown> }) {
  return (
    <details className="props" style={{ margin: '14px var(--pad-screen) 0' }}>
      <summary>Properties · {Object.keys(data).length}</summary>
      <div className="props__grid">
        {Object.entries(data).map(([key, value]) => (
          <FragmentRow key={key} k={key} v={value} />
        ))}
      </div>
    </details>
  );
}

function FragmentRow({ k, v }: { k: string; v: unknown }) {
  return (
    <>
      <span className="props__key">{k}</span>
      <span className="props__value">{formatValue(v)}</span>
    </>
  );
}

function formatValue(v: unknown): string {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join(', ');
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Flip "- [ ]" <-> "- [x]" on the given 1-based line of the full note text. */
export function toggleTaskAtLine(text: string, line: number): string | null {
  const lines = text.split('\n');
  const i = line - 1;
  if (i < 0 || i >= lines.length) return null;
  const current = lines[i];
  const toggled = current.replace(
    /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/,
    (_, pre: string, mark: string, post: string) =>
      `${pre}${mark === ' ' ? 'x' : ' '}${post}`,
  );
  if (toggled === current) return null;
  lines[i] = toggled;
  return lines.join('\n');
}
