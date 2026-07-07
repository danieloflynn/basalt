import { useCallback, useEffect, useState } from 'react';
import { parseFrontmatter } from '@/lib/frontmatter';
import { applyTaskSort, sortToggledTask, toggleTaskAtLine } from '@/lib/tasks';
import { useSettings, vaultService } from '@/services';
import { useNav } from '@/state/nav';
import { IconDots, IconPencil } from '@/ui/icons';
import { Markdown, scrollToHeading } from '@/ui/markdown/Markdown';
import { InlineTitle } from '@/ui/components/InlineTitle';
import { NoteMenu } from '@/ui/components/NoteMenu';
import { SidebarToggle } from '@/ui/workspace/chrome';
import { usePullDown } from '@/ui/hooks/usePullDown';

/** Reading view — Obsidian layout: sidebar toggle left, edit + menu right, inline title. */
export function NoteScreen({ path, heading }: { path: string; heading?: string }) {
  const nav = useNav();
  // Seed from the content cache so a rename-triggered remount doesn't flash the
  // loading state or lose the rendered body — the retitle stays smooth.
  const [text, setText] = useState<string | null>(() => vaultService.noteContent(path) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Obsidian's pull-down-to-search, on the reading scroller.
  const scrollRef = usePullDown<HTMLDivElement>(() => nav.setOverlay('quickopen'));

  useEffect(() => {
    let cancelled = false;
    if (vaultService.noteContent(path) === undefined) setText(null);
    setError(null);
    vaultService
      .readNote(path)
      .then((t) => {
        if (cancelled) return;
        setText(t);
        if (heading) {
          requestAnimationFrame(() => requestAnimationFrame(() => scrollToHeading(heading)));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path, heading]);

  const toggleTask = useCallback(
    (line: number) => {
      if (text === null) return;
      let updated = toggleTaskAtLine(text, line);
      if (updated === null) return;
      if (useSettings.getState().settings.sortCheckedToBottom) {
        const region = sortToggledTask(updated, line);
        if (region) updated = applyTaskSort(updated, region);
      }
      setText(updated);
      void vaultService.writeNote(path, updated);
    },
    [text, path],
  );

  const fm = text !== null ? parseFrontmatter(text) : null;
  const fmLineOffset = fm?.raw != null ? fm.raw.split('\n').length + 2 : 0;

  return (
    <div className="screen">
      <header className="workspace-top">
        <SidebarToggle />
        <span style={{ flex: 1 }} />
        <div className="workspace-top__group">
          <button
            className="iconbtn"
            aria-label="Edit note"
            onClick={() => {
              // Sticky: flip the global default so every note opens to edit.
              nav.setViewMode('editing');
              void useSettings.getState().update({ defaultView: 'editing' });
              nav.replace({ name: 'edit', path });
            }}
          >
            <IconPencil size={20} />
          </button>
          <button className="iconbtn" aria-label="Note menu" onClick={() => setMenuOpen(true)}>
            <IconDots size={20} />
          </button>
        </div>
      </header>

      <div className="scroll" ref={scrollRef}>
        {error !== null && (
          <div className="state">
            <p className="state__title">Couldn't open this note</p>
            <p className="state__hint">{error}</p>
          </div>
        )}
        {error === null && text === null && <div className="state" />}
        {fm !== null && (
          <>
            <InlineTitle path={path} />
            {Object.keys(fm.data).length > 0 && <Properties data={fm.data} />}
            <Markdown
              source={fm.body}
              path={path}
              onToggleTask={(line) => toggleTask(line + fmLineOffset)}
            />
          </>
        )}
      </div>

      {menuOpen && <NoteMenu path={path} onClose={() => setMenuOpen(false)} />}
    </div>
  );
}

function Properties({ data }: { data: Record<string, unknown> }) {
  return (
    <details className="props" style={{ margin: '4px var(--pad-screen) 0' }}>
      <summary>Properties · {Object.keys(data).length}</summary>
      <div className="props__grid">
        {Object.entries(data).map(([key, value]) => (
          <PropRow key={key} k={key} v={value} />
        ))}
      </div>
    </details>
  );
}

function PropRow({ k, v }: { k: string; v: unknown }) {
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
