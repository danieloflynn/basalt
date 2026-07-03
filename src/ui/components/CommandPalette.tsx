import { useEffect, useMemo, useRef, useState } from 'react';
import { syncService, useSettings, vaultService, type NoteMeta } from '@/services';
import { useNav } from '@/state/nav';
import { defaultNewNoteFolder, insertTemplate, listTemplateNotes } from '@/ui/templates';
import {
  IconCalendar,
  IconCommand,
  IconGraph,
  IconHistory,
  IconNotePlus,
  IconSettings,
  IconStar,
  IconSync,
  IconTag,
} from '@/ui/icons';

type TemplatePicker = { mode: 'new' | 'insert'; items: NoteMeta[] };

interface Command {
  id: string;
  label: string;
  icon: React.ReactNode;
  run: () => void | Promise<void>;
}

/** Obsidian-style command palette (bottom pill ☰). */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const nav = useNav();
  const { settings, update } = useSettings();
  const [query, setQuery] = useState('');
  const [picker, setPicker] = useState<TemplatePicker | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  const commands: Command[] = useMemo(
    () => [
      {
        id: 'daily',
        label: "Open today's daily note",
        icon: <IconCalendar size={18} />,
        run: async () => {
          const path = await vaultService.openDailyNote();
          nav.push({ name: 'note', path });
        },
      },
      {
        id: 'template',
        label: 'New note from template',
        icon: <IconNotePlus size={18} />,
        run: () => setPicker({ mode: 'new', items: listTemplateNotes() }),
      },
      {
        id: 'insert-template',
        label: 'Insert template',
        icon: <IconCommand size={18} />,
        run: () => setPicker({ mode: 'insert', items: listTemplateNotes() }),
      },
      {
        id: 'sync',
        label: 'Sync now',
        icon: <IconSync size={18} />,
        run: () => void syncService.syncNow('palette'),
      },
      {
        id: 'graph',
        label: 'Open graph view',
        icon: <IconGraph size={18} />,
        run: () => nav.push({ name: 'graph' }),
      },
      {
        id: 'tags',
        label: 'Browse tags',
        icon: <IconTag size={18} />,
        run: () => nav.openSidebar('tags'),
      },
      {
        id: 'bookmarks',
        label: 'Open bookmarks',
        icon: <IconStar size={18} />,
        run: () => nav.openSidebar('bookmarks'),
      },
      {
        id: 'history',
        label: 'Vault history',
        icon: <IconHistory size={18} />,
        run: () => nav.push({ name: 'history' }),
      },
      {
        id: 'theme',
        // Cycles the *setting* (system → dark → light); "switch to dark" read
        // wrong when system already rendered dark.
        label: `Theme: ${settings.theme} → ${settings.theme === 'dark' ? 'light' : settings.theme === 'light' ? 'system' : 'dark'}`,
        icon: <IconCommand size={18} />,
        run: () =>
          void update({
            theme: settings.theme === 'dark' ? 'light' : settings.theme === 'light' ? 'system' : 'dark',
          }),
      },
      {
        id: 'settings',
        label: 'Open settings',
        icon: <IconSettings size={18} />,
        run: () => nav.push({ name: 'settings' }),
      },
    ],
    [nav, settings.theme, update],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  const opensPicker = (id: string) => id === 'template' || id === 'insert-template';

  const runCommand = async (c: Command) => {
    const result = c.run();
    if (!opensPicker(c.id)) onClose();
    await result;
  };

  if (picker !== null) {
    const { mode, items } = picker;
    return (
      <>
        <div className="scrim" onClick={onClose} />
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
      <div className="scrim" onClick={onClose} />
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
          {filtered.map((c) => (
            <button key={c.id} className="tree-row" onClick={() => void runCommand(c)}>
              <span className="row__icon">{c.icon}</span>
              <span className="tree-row__name">{c.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
