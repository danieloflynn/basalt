import { useCallback, useEffect, useRef, useState } from 'react';
import { parseFrontmatter } from '@/lib/frontmatter';
import {
  addArrayItem,
  applyPropertyEdit,
  coerceScalarInput,
  isEditableScalar,
  isEditableStringArray,
  removeArrayItem,
  removeProperty,
} from '@/lib/propertyEdit';
import { applyTaskSort, sortToggledTask, toggleTaskAtLine } from '@/lib/tasks';
import { useSettings, vaultService } from '@/services';
import { useNav } from '@/state/nav';
import { IconCheck, IconDots, IconPencil, IconPlus, IconX } from '@/ui/icons';
import { Markdown, scrollToHeading } from '@/ui/markdown/Markdown';
import { InlineTitle } from '@/ui/components/InlineTitle';
import { NoteMenu } from '@/ui/components/NoteMenu';
import { PaneHeader } from '@/ui/workspace/PaneHeader';
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

  // Desktop-only: PropertiesExpanded's edits (value/array/add/delete) all
  // reduce to "mutate the raw note text, then write it" — same setText-then-
  // writeNote shape as toggleTask above, which is what makes the reader
  // re-render with fresh frontmatter immediately (no indexVersion plumbing
  // needed: NoteScreen never subscribes to useVault, it holds its own text
  // state seeded from/written through vaultService's content cache).
  const commitFrontmatter = useCallback(
    (mutate: (t: string) => string) => {
      if (text === null) return;
      const updated = mutate(text);
      if (updated === text) return;
      setText(updated);
      void vaultService.writeNote(path, updated);
    },
    [text, path],
  );

  const fm = text !== null ? parseFrontmatter(text) : null;
  const fmLineOffset = fm?.raw != null ? fm.raw.split('\n').length + 2 : 0;

  return (
    <div className="screen">
      {nav.desktop ? (
        <PaneHeader path={path} mode="reading" onOpenMenu={() => setMenuOpen(true)} />
      ) : (
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
      )}

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
            {Object.keys(fm.data).length > 0 &&
              (nav.desktop ? (
                <PropertiesExpanded data={fm.data} onCommit={commitFrontmatter} />
              ) : (
                <Properties data={fm.data} />
              ))}
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

/** Desktop-only expanded properties table (Obsidian): rows, no collapse, and
 * editable — the mobile "PROPERTIES · N" pill above stays exactly as-is on
 * phones. `onCommit` takes a pure text -> text mutator (from
 * `src/lib/propertyEdit`), applies it to the note's raw text, and writes the
 * result through vaultService; only one row edits at a time (`editingKey`),
 * which is also how a duplicate "Add property" key is handled — instead of
 * erroring, we just re-point editingKey at the existing row. */
function PropertiesExpanded({
  data,
  onCommit,
}: {
  data: Record<string, unknown>;
  onCommit: (mutate: (t: string) => string) => void;
}) {
  const keys = Object.keys(data);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="props-expanded" style={{ margin: '4px var(--pad-screen) 0' }}>
      <div className="props-expanded__head">Properties</div>
      {keys.map((key) => (
        <PropExpandedRow
          key={key}
          k={key}
          v={data[key]}
          editing={editingKey === key}
          onStartEdit={() => setEditingKey(key)}
          onStopEdit={() => setEditingKey((cur) => (cur === key ? null : cur))}
          onCommitValue={(raw) => {
            const value = coerceScalarInput(data[key], raw);
            onCommit((t) => applyPropertyEdit(t, key, value));
            setEditingKey((cur) => (cur === key ? null : cur));
          }}
          onDelete={() => onCommit((t) => removeProperty(t, key))}
          onAddArrayItem={(item) => onCommit((t) => addArrayItem(t, key, item))}
          onRemoveArrayItem={(item) => onCommit((t) => removeArrayItem(t, key, item))}
        />
      ))}
      <AddPropertyRow
        open={adding}
        onOpen={() => setAdding(true)}
        onCancel={() => setAdding(false)}
        onCommit={(key, value) => {
          if (keys.includes(key)) {
            // Duplicate key: focus the existing row's value instead of erroring.
            setEditingKey(key);
            setAdding(false);
            return;
          }
          onCommit((t) => applyPropertyEdit(t, key, value));
          setAdding(false);
        }}
      />
    </div>
  );
}

function PropExpandedRow({
  k,
  v,
  editing,
  onStartEdit,
  onStopEdit,
  onCommitValue,
  onDelete,
  onAddArrayItem,
  onRemoveArrayItem,
}: {
  k: string;
  v: unknown;
  editing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onCommitValue: (raw: string) => void;
  onDelete: () => void;
  onAddArrayItem: (item: string) => void;
  onRemoveArrayItem: (item: string) => void;
}) {
  return (
    <div className="props-expanded__row">
      <span className="props-expanded__key">{k}</span>
      {isEditableStringArray(v) ? (
        <span className="props-expanded__value">
          {v.map((item, i) => (
            <span key={`${item}-${i}`} className="tag props-expanded__tag">
              {item}
              <button
                type="button"
                className="props-expanded__tag-remove"
                aria-label={`Remove ${item}`}
                onClick={() => onRemoveArrayItem(item)}
              >
                <IconX size={9} />
              </button>
            </span>
          ))}
          <ArrayAddInput onAdd={onAddArrayItem} />
        </span>
      ) : editing && isEditableScalar(v) ? (
        <ScalarEditInput initial={formatValue(v)} onCommit={onCommitValue} onCancel={onStopEdit} />
      ) : isEditableScalar(v) ? (
        <button
          type="button"
          className="props-expanded__value props-expanded__value--edit"
          onClick={onStartEdit}
        >
          {formatValue(v)}
        </button>
      ) : (
        <span className="props-expanded__value">{formatValue(v)}</span>
      )}
      <button
        type="button"
        className="props-expanded__delete"
        aria-label={`Delete ${k} property`}
        onClick={onDelete}
      >
        <IconX size={12} />
      </button>
    </div>
  );
}

/** Single-line scalar editor: Enter or blur commits, Escape cancels. `done`
 * guards against a double-commit when Enter's own re-render/unmount would
 * otherwise also fire the blur handler. */
function ScalarEditInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (raw: string) => void;
  onCancel: () => void;
}) {
  const done = useRef(false);
  return (
    <input
      className="props-expanded__value-input"
      defaultValue={initial}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          done.current = true;
          onCommit(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          done.current = true;
          onCancel();
        }
      }}
      onBlur={(e) => {
        if (done.current) return;
        done.current = true;
        onCommit(e.currentTarget.value);
      }}
    />
  );
}

/** Always-visible trailing pill-input for an array property; Enter appends the item. */
function ArrayAddInput({ onAdd }: { onAdd: (item: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <input
      className="props-expanded__tag-input"
      placeholder="+"
      aria-label="Add item"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        const trimmed = value.trim();
        if (!trimmed) return;
        onAdd(trimmed);
        setValue('');
      }}
    />
  );
}

/** The table's bottom "Add property" affordance: a faint button that opens
 * key/value inputs; Enter in either (or the check button) commits, Escape
 * (or the x button) cancels. Empty keys are silently rejected. */
function AddPropertyRow({
  open,
  onOpen,
  onCancel,
  onCommit,
}: {
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onCommit: (key: string, value: string) => void;
}) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  if (!open) {
    return (
      <button type="button" className="props-expanded__add" onClick={onOpen}>
        <IconPlus size={13} /> Add property
      </button>
    );
  }

  const reset = () => {
    setKey('');
    setValue('');
  };
  const commit = () => {
    const trimmed = key.trim();
    if (!trimmed) return; // reject empty keys, silently — no error UI
    onCommit(trimmed, value);
    reset();
  };
  const cancel = () => {
    onCancel();
    reset();
  };

  return (
    <div className="props-expanded__add-row">
      <input
        className="props-expanded__add-key"
        placeholder="Name"
        aria-label="Property name"
        value={key}
        autoFocus
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') cancel();
        }}
      />
      <input
        className="props-expanded__add-value"
        placeholder="Value"
        aria-label="Property value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') cancel();
        }}
      />
      <button
        type="button"
        className="props-expanded__add-confirm"
        aria-label="Add property"
        onClick={commit}
      >
        <IconCheck size={13} />
      </button>
      <button
        type="button"
        className="props-expanded__add-cancel"
        aria-label="Cancel add property"
        onClick={cancel}
      >
        <IconX size={13} />
      </button>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join(', ');
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
