import type { ReactNode } from 'react';
import { runCommand } from '@/commands/registry';
import { IconCalendar, IconCommand, IconGraph, IconSearch, IconSync } from '@/ui/icons';

const RIBBON_ITEMS: {
  id: string;
  name: string;
  icon: (p: { size?: number }) => ReactNode;
}[] = [
  { id: 'open-quick-switcher', name: 'Quick switcher', icon: (p) => <IconSearch {...p} /> },
  { id: 'graph', name: 'Graph view', icon: (p) => <IconGraph {...p} /> },
  { id: 'daily', name: "Today's daily note", icon: (p) => <IconCalendar {...p} /> },
  { id: 'open-command-palette', name: 'Command palette', icon: (p) => <IconCommand {...p} /> },
  { id: 'sync', name: 'Sync now', icon: (p) => <IconSync {...p} /> },
];

/**
 * Obsidian-style left ribbon: a vertical strip of global command shortcuts,
 * a direct grid column of its own (desktop-only) so it stays visible even
 * with the file-tree sidebar collapsed. Each button just invokes the same
 * command the command palette would run — see `runCommand`.
 */
export function Ribbon() {
  return (
    <div className="ribbon" role="toolbar" aria-label="Ribbon" aria-orientation="vertical">
      {RIBBON_ITEMS.map((item) => (
        <button
          key={item.id}
          className="ribbon__item"
          title={item.name}
          aria-label={item.name}
          onClick={() => runCommand(item.id)}
        >
          {item.icon({ size: 22 })}
        </button>
      ))}
    </div>
  );
}
