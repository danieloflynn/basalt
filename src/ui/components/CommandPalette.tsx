import { useEffect, useMemo, useRef, useState } from 'react';
import { syncService, useSettings, vaultService, type NoteMeta } from '@/services';
import { useNav } from '@/state/nav';
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
  const [templates, setTemplates] = useState<NoteMeta[] | null>(null);
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
        run: async () => {
          setTemplates(await vaultService.listTemplates());
          return;
        },
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

  const runCommand = async (c: Command) => {
    const result = c.run();
    if (c.id !== 'template') onClose();
    await result;
  };

  if (templates !== null) {
    return (
      <>
        <div className="scrim" onClick={onClose} />
        <div className="quickopen">
          <p className="sheet__title" style={{ padding: '8px 12px' }}>
            {templates.length ? 'Choose a template' : 'No templates found'}
          </p>
          {templates.length === 0 && (
            <p className="state__hint" style={{ padding: '0 14px 14px' }}>
              Put template notes in a "Templates" folder (or the folder set in Obsidian's
              Templates plugin settings).
            </p>
          )}
          <div className="quickopen__results">
            {templates.map((t) => (
              <button
                key={t.path}
                className="tree-row"
                onClick={async () => {
                  onClose();
                  const path = await vaultService.createFromTemplate(t.path);
                  useNav.getState().push({ name: 'edit', path });
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
