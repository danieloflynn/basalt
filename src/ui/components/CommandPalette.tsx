import { useEffect, useMemo, useRef, useState } from 'react';
import { type AppCommand, listCommands } from '@/commands/registry';
import { effectiveHotkeys, formatChord } from '@/services/hotkeys';
import { useSettings, vaultService, type NoteMeta } from '@/services';
import { useNav } from '@/state/nav';
import { defaultNewNoteFolder, insertTemplate, listTemplateNotes } from '@/ui/templates';

type TemplatePicker = { mode: 'new' | 'insert'; items: NoteMeta[] };

/** Obsidian-style fuzzy match: substring OR query letters in order (case-insensitive). */
function matchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const label = name.toLowerCase();
  if (label.includes(q)) return true;
  let qi = 0;
  for (let li = 0; li < label.length && qi < q.length; li++) {
    if (label[li] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** Obsidian-style command palette (bottom pill ☰ / Mod+P). */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  // No destructure: this subscribes to the whole settings store purely so the
  // component re-renders (and re-reads listCommands()) when theme changes —
  // the theme command's label is computed fresh inside listCommands() itself.
  useSettings();
  // Hotkey hints are desktop-only (Obsidian mobile shows none — a ⌘P hint on a
  // phone row is noise, and it would vary with the host running the tests).
  const desktop = useNav((s) => s.desktop);
  const [query, setQuery] = useState('');
  const [picker, setPicker] = useState<TemplatePicker | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  // listCommands() isn't a hook — recomputed every render (cheap: ~20 plain
  // objects), which is what keeps the theme command's dynamic label fresh off
  // the `settings` subscription above (no memo, so no stale-deps risk). The
  // `template` / `insert-template` ids keep their picker-opening UI local to
  // this component (it owns `picker` state), so we swap in local handlers for
  // just those two ids rather than teaching the registry about this
  // component's local state.
  const commands: AppCommand[] = listCommands().map((c) => {
    if (c.id === 'template') {
      return { ...c, run: () => setPicker({ mode: 'new', items: listTemplateNotes() }) };
    }
    if (c.id === 'insert-template') {
      return { ...c, run: () => setPicker({ mode: 'insert', items: listTemplateNotes() }) };
    }
    return c;
  });

  const hotkeys = effectiveHotkeys();

  const filtered = useMemo(
    () => commands.filter((c) => matchesQuery(c.name, query)),
    [commands, query],
  );

  const opensPicker = (id: string) => id === 'template' || id === 'insert-template';

  const runCommand = async (c: AppCommand) => {
    const result = c.run();
    if (!opensPicker(c.id)) onClose();
    await result;
  };

  if (picker !== null) {
    const { mode, items } = picker;
    return (
      <>
        <div className="scrim scrim--overlay" onClick={onClose} />
        <div className="quickopen">
          <p className="sheet__title" style={{ padding: '8px 12px' }}>
            {items.length === 0
              ? 'No templates found'
              : mode === 'insert'
                ? 'Insert a template'
                : 'New note from template'}
          </p>
          {items.length === 0 && (
            <p className="state__hint" style={{ padding: '0 14px 14px' }}>
              Put template notes in your template folder, then set its location under
              Settings → Templates.
            </p>
          )}
          <div className="quickopen__results">
            {items.map((t) => (
              <button
                key={t.path}
                className="tree-row"
                onClick={async () => {
                  onClose();
                  if (mode === 'insert') {
                    await insertTemplate(t.path);
                  } else {
                    const path = await vaultService.createFromTemplate(
                      t.path,
                      defaultNewNoteFolder(),
                    );
                    useNav.getState().push({ name: 'edit', path });
                  }
                }}
              >
                <span className="tree-row__name">{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="scrim scrim--overlay" onClick={onClose} />
      <div className="quickopen">
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && filtered[0]) void runCommand(filtered[0]);
          }}
        />
        <div className="quickopen__results">
          {filtered.map((c) => {
            const chord = desktop ? hotkeys[c.id]?.[0] : undefined;
            return (
              <button key={c.id} className="tree-row" onClick={() => void runCommand(c)}>
                <span className="row__icon">{c.icon}</span>
                <span className="tree-row__name">{c.name}</span>
                {chord && <span className="palette-hint">{formatChord(chord)}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
