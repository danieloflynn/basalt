import { useEffect, useMemo, useState } from 'react';
import type { HeadingInfo } from '@/lib/outline';
import { flushActiveEditor } from '@/lib/editorFlush';
import { parseFrontmatter, serializeFrontmatter } from '@/lib/frontmatter';
import { basename, noteTitle } from '@/lib/paths';
import { vaultService, useVault, type Backlink } from '@/services';
import { openNote, useNav } from '@/state/nav';
import { scrollToHeading } from '@/ui/markdown/Markdown';
import { backlinkContext } from '@/ui/workspace/RightSidebar';
import { IconGraph, IconMove, IconPlus, IconStar, IconX } from '@/ui/icons';
import { FolderPicker } from './FolderPicker';

type Tab = 'outline' | 'backlinks' | 'properties';

/** Slide-up panel on the reader: outline, backlinks, and a frontmatter editor. */
export function NoteInfoSheet({
  path,
  initialTab = 'outline',
  onClose,
}: {
  path: string;
  initialTab?: Tab;
  onClose: () => void;
}) {
  const nav = useNav();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [moving, setMoving] = useState(false);
  const bookmarks = useVault((s) => s.bookmarks);
  const bookmarked = bookmarks.includes(path);

  const outline = useMemo(() => vaultService.outlineOf(path), [path]);
  const backlinks = useMemo(() => vaultService.backlinksOf(path), [path]);

  if (moving) {
    return (
      <FolderPicker
        title={`Move "${basename(path)}" to…`}
        onClose={() => setMoving(false)}
        onPick={async (folder) => {
          setMoving(false);
          onClose();
          // Safe move (dedupe + inbound link rewrite + bookmark migration);
          // moveFile no-ops when the folder is unchanged and returns the final
          // path so we can repoint every tab's history.
          await flushActiveEditor();
          const finalPath = await vaultService.moveFile(path, folder);
          if (finalPath !== path) nav.renamePath(path, finalPath);
        }}
      />
    );
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" style={{ maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
        <div className="sheet__grab" />

        <div style={{ display: 'flex', gap: 4, padding: '0 10px 6px' }}>
          <button
            className="iconbtn"
            aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this note'}
            style={bookmarked ? { color: 'var(--ember)' } : undefined}
            onClick={() => void vaultService.toggleBookmark(path)}
          >
            <IconStar size={20} fill={bookmarked ? 'currentColor' : 'none'} />
          </button>
          <button
            className="iconbtn"
            aria-label="Local graph"
            onClick={() => {
              onClose();
              nav.push({ name: 'graph', path });
            }}
          >
            <IconGraph size={20} />
          </button>
          <button className="iconbtn" aria-label="Move note" onClick={() => setMoving(true)}>
            <IconMove size={20} />
          </button>
          <div style={{ flex: 1 }} />
          <div className="segments" style={{ flex: 3 }}>
            {(['outline', 'backlinks', 'properties'] as Tab[]).map((t) => (
              <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
                {t === 'outline' ? 'Outline' : t === 'backlinks' ? `Links (${backlinks.length})` : 'Props'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '4px 10px 8px' }}>
          {tab === 'outline' && <OutlinePanel outline={outline} onClose={onClose} />}
          {tab === 'backlinks' && (
            <BacklinksPanel backlinks={backlinks} title={noteTitle(path)} onClose={onClose} />
          )}
          {tab === 'properties' && <PropertiesEditor path={path} />}
        </div>
      </div>
    </>
  );
}

function OutlinePanel({ outline, onClose }: { outline: HeadingInfo[]; onClose: () => void }) {
  if (outline.length === 0) {
    return <p className="state__hint" style={{ padding: 14 }}>No headings in this note.</p>;
  }
  return (
    <>
      {outline.map((h, i) => (
        <button
          key={`${h.slug}-${i}`}
          className="sheet__item"
          style={{ paddingLeft: 14 + (h.level - 1) * 16, minHeight: 42 }}
          onClick={() => {
            onClose();
            requestAnimationFrame(() => scrollToHeading(h.text));
          }}
        >
          <span style={{ color: 'var(--text-faint)', fontSize: 'var(--text-xs)', width: 22 }}>
            H{h.level}
          </span>
          {h.text}
        </button>
      ))}
    </>
  );
}

function BacklinksPanel({
  backlinks,
  title,
  onClose,
}: {
  backlinks: Backlink[];
  title: string;
  onClose: () => void;
}) {
  if (backlinks.length === 0) {
    return (
      <p className="state__hint" style={{ padding: 14 }}>
        No other notes link here yet.
      </p>
    );
  }
  return (
    <>
      {backlinks.map((b) => (
        <button
          key={b.path}
          className="sheet__item"
          style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 2 }}
          onClick={() => {
            onClose();
            openNote(b.path);
          }}
        >
          <span style={{ fontWeight: 600 }}>{b.title}</span>
          {b.context && <span className="hit__excerpt">{backlinkContext(b.context, title)}</span>}
        </button>
      ))}
    </>
  );
}

/** Frontmatter editor: string/list values as text, add and remove keys. */
function PropertiesEditor({ path }: { path: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [body, setBody] = useState('');
  const [newKey, setNewKey] = useState('');

  useEffect(() => {
    void vaultService.readNote(path).then((text) => {
      const fm = parseFrontmatter(text);
      setData(fm.data);
      setBody(fm.body);
    });
  }, [path]);

  if (data === null) return null;

  const commit = (next: Record<string, unknown>) => {
    setData(next);
    void vaultService.writeNote(path, serializeFrontmatter(next, body));
  };

  return (
    <div style={{ padding: '4px 6px' }}>
      {Object.entries(data).map(([key, value]) => (
        <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span
            style={{
              width: 90,
              flexShrink: 0,
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {key}
          </span>
          <input
            className="dialog__input"
            style={{ height: 38, flex: 1 }}
            defaultValue={displayValue(value)}
            onBlur={(e) => {
              const parsed = parseValue(e.target.value, value);
              if (displayValue(parsed) !== displayValue(value)) commit({ ...data, [key]: parsed });
            }}
          />
          <button
            className="iconbtn"
            aria-label={`Remove ${key}`}
            style={{ width: 36, height: 36 }}
            onClick={() => {
              const next = { ...data };
              delete next[key];
              commit(next);
            }}
          >
            <IconX size={16} />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input
          className="dialog__input"
          style={{ height: 38 }}
          placeholder="Add property…"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newKey.trim()) {
              commit({ ...data, [newKey.trim()]: '' });
              setNewKey('');
            }
          }}
        />
        <button
          className="iconbtn"
          aria-label="Add property"
          onClick={() => {
            if (newKey.trim()) {
              commit({ ...data, [newKey.trim()]: '' });
              setNewKey('');
            }
          }}
        >
          <IconPlus size={18} />
        </button>
      </div>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', padding: '10px 2px 4px' }}>
        Lists can be written comma-separated. Changes save straight into the note's frontmatter.
      </p>
    </div>
  );
}

function displayValue(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(String).join(', ');
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function parseValue(text: string, previous: unknown): unknown {
  const t = text.trim();
  if (Array.isArray(previous) || t.includes(',')) {
    return t
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t);
  return t;
}
