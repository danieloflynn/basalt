import type { ReactNode } from 'react';
import { syncService, useSettings, vaultService } from '@/services';
import { focusedScreen, useNav } from '@/state/nav';
import { defaultNewNoteFolder } from '@/ui/templates';
import {
  IconBack,
  IconCalendar,
  IconCommand,
  IconFolder,
  IconGraph,
  IconHistory,
  IconNotePlus,
  IconPencil,
  IconSearch,
  IconSettings,
  IconStar,
  IconSync,
  IconTabs,
  IconTag,
  IconWikilink,
  IconX,
} from '@/ui/icons';

export interface AppCommand {
  id: string;
  name: string;
  icon?: ReactNode;
  run: () => void | Promise<void>;
}

/**
 * Every command reachable from the command palette and global hotkeys, in one
 * place. NOT a hook: `run()` (and this function itself) reads
 * `useNav.getState()` / `useSettings.getState()` fresh each call, so it can be
 * invoked from outside React (the global keydown handler in
 * `src/services/hotkeys.ts`) as well as from CommandPalette.
 *
 * `template` / `insert-template` only open the palette here — the actual
 * template-picker UI (choosing which template note) lives inside
 * CommandPalette itself, which owns that picker's local state. CommandPalette
 * swaps these two ids' `run` for its own picker-opening handlers when it
 * renders the list; this registry's version is just the sane fallback if
 * either id is ever invoked directly (e.g. a future hotkey binding) without
 * the palette already open.
 */
export function listCommands(): AppCommand[] {
  const { settings } = useSettings.getState();
  const nextTheme =
    settings.theme === 'dark' ? 'light' : settings.theme === 'light' ? 'system' : 'dark';

  return [
    {
      id: 'daily',
      name: "Open today's daily note",
      icon: <IconCalendar size={18} />,
      run: async () => {
        const path = await vaultService.openDailyNote();
        useNav.getState().push({ name: 'note', path });
      },
    },
    {
      id: 'template',
      name: 'New note from template',
      icon: <IconNotePlus size={18} />,
      run: () => useNav.getState().setOverlay('palette'),
    },
    {
      id: 'insert-template',
      name: 'Insert template',
      icon: <IconCommand size={18} />,
      run: () => useNav.getState().setOverlay('palette'),
    },
    {
      id: 'sync',
      name: 'Sync now',
      icon: <IconSync size={18} />,
      run: () => void syncService.syncNow('palette'),
    },
    {
      id: 'graph',
      name: 'Graph view: Open graph view',
      icon: <IconGraph size={18} />,
      run: () => useNav.getState().push({ name: 'graph' }),
    },
    {
      id: 'tags',
      name: 'Browse tags',
      icon: <IconTag size={18} />,
      run: () => useNav.getState().openSidebar('tags'),
    },
    {
      id: 'bookmarks',
      name: 'Open bookmarks',
      icon: <IconStar size={18} />,
      run: () => useNav.getState().openSidebar('bookmarks'),
    },
    {
      id: 'history',
      name: 'Vault history',
      icon: <IconHistory size={18} />,
      run: () => useNav.getState().push({ name: 'history' }),
    },
    {
      id: 'theme',
      // Cycles the *setting* (system → dark → light); "switch to dark" read
      // wrong when system already rendered dark.
      name: `Theme: ${settings.theme} → ${nextTheme}`,
      icon: <IconCommand size={18} />,
      run: () => void useSettings.getState().update({ theme: nextTheme }),
    },
    {
      id: 'settings',
      name: 'Open settings',
      icon: <IconSettings size={18} />,
      run: () => useNav.getState().push({ name: 'settings' }),
    },
    {
      id: 'open-quick-switcher',
      name: 'Quick switcher: Open quick switcher',
      icon: <IconSearch size={18} />,
      run: () => useNav.getState().setOverlay('quickopen'),
    },
    {
      id: 'open-command-palette',
      name: 'Command palette: Open command palette',
      icon: <IconCommand size={18} />,
      run: () => useNav.getState().setOverlay('palette'),
    },
    {
      id: 'new-note',
      name: 'Create new note',
      icon: <IconNotePlus size={18} />,
      run: async () => {
        const path = await vaultService.createNote(defaultNewNoteFolder(), 'Untitled');
        useNav.getState().push({ name: 'edit', path });
      },
    },
    {
      id: 'toggle-view-mode',
      name: 'Toggle reading/editing view',
      icon: <IconPencil size={18} />,
      run: () => {
        const nav = useNav.getState();
        // Focused pane's screen (= current screen without a split): the pane
        // header toggle and ⌘E flip whichever pane is active, like Obsidian.
        const screen = focusedScreen(nav);
        // Sticky, same as the mobile header toggle buttons: flipping the mode
        // also flips the persisted global default (`defaultView` in settings).
        if (screen.name === 'note') {
          nav.replace({ name: 'edit', path: screen.path, heading: screen.heading });
          nav.setViewMode('editing');
          void useSettings.getState().update({ defaultView: 'editing' });
        } else if (screen.name === 'edit') {
          nav.replace({ name: 'note', path: screen.path, heading: screen.heading });
          nav.setViewMode('reading');
          void useSettings.getState().update({ defaultView: 'reading' });
        }
      },
    },
    {
      id: 'go-back',
      name: 'Navigate back',
      icon: <IconBack size={18} />,
      run: () => useNav.getState().back(),
    },
    {
      id: 'go-forward',
      name: 'Navigate forward',
      icon: <IconBack size={18} style={{ transform: 'rotate(180deg)' }} />,
      run: () => useNav.getState().forward(),
    },
    {
      id: 'new-tab',
      name: 'Open new tab',
      icon: <IconTabs size={18} />,
      run: () => useNav.getState().newTab(),
    },
    {
      id: 'close-tab',
      name: 'Close current tab',
      icon: <IconX size={18} />,
      run: () => {
        const nav = useNav.getState();
        nav.closeTab(nav.active);
      },
    },
    {
      id: 'toggle-left-sidebar',
      name: 'Toggle left sidebar',
      icon: <IconFolder size={18} />,
      run: () => useNav.getState().toggleSidebar(),
    },
    {
      id: 'toggle-right-sidebar',
      name: 'Toggle right sidebar',
      icon: <IconWikilink size={18} />,
      run: () => useNav.getState().toggleRightSidebar(),
    },
    {
      id: 'global-search',
      name: 'Search: Search in all files',
      icon: <IconSearch size={18} />,
      run: () => useNav.getState().openSidebar('search'),
    },
  ];
}

/** Look up a command by id and run it — the ribbon's one-liner invocation. */
export function runCommand(id: string): void {
  void listCommands().find((c) => c.id === id)?.run();
}
