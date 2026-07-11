import { listCommands } from '@/commands/registry';
import { useSettings } from './settings';

/**
 * True on macOS (Cmd is the primary modifier), false everywhere else (Ctrl
 * is). Checked via `navigator.platform` first (still the most reliable signal
 * where present — Electron's Chromium and every real browser set it), falling
 * back to a userAgent sniff.
 */
function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/Mac/i.test(navigator.platform ?? '')) return true;
  return /Macintosh|Mac OS X/i.test(navigator.userAgent ?? '');
}

/**
 * Obsidian-compatible macOS defaults. `Mod` = Cmd on Mac, Ctrl elsewhere (see
 * `eventToChord`). Commands with an empty array are deliberately unbound out
 * of the box (still reachable from the command palette).
 */
export const DEFAULT_HOTKEYS: Record<string, string[]> = {
  'open-command-palette': ['Mod+P'],
  'open-quick-switcher': ['Mod+O'],
  'new-note': ['Mod+N'],
  'toggle-view-mode': ['Mod+E'],
  'global-search': ['Mod+Shift+F'],
  graph: ['Mod+G'],
  settings: ['Mod+,'],
  'new-tab': ['Mod+T'],
  'close-tab': ['Mod+W'],
  'go-back': ['Mod+Alt+ArrowLeft'],
  'go-forward': ['Mod+Alt+ArrowRight'],
  daily: [],
  sync: [],
  'toggle-left-sidebar': [],
  'toggle-right-sidebar': [],
};

const BARE_MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift']);

/**
 * Normalize a keydown into a chord string like `Mod+Shift+F`, or null for a
 * bare modifier keydown (nothing to bind). Fixed segment order:
 * `Mod+Ctrl+Alt+Shift+Key` — `Mod` is metaKey on Mac / ctrlKey elsewhere;
 * `Ctrl` only appears standalone on Mac, where the physical Control key is a
 * modifier distinct from Cmd. Single-character keys are uppercased (letters;
 * ',' is unaffected); everything else (arrows, function keys, …) keeps
 * `e.key` verbatim.
 */
export function eventToChord(e: KeyboardEvent): string | null {
  if (BARE_MODIFIER_KEYS.has(e.key)) return null;

  const mac = isMac();
  const mod = mac ? e.metaKey : e.ctrlKey;
  const ctrl = mac ? e.ctrlKey : false;

  const parts: string[] = [];
  if (mod) parts.push('Mod');
  if (ctrl) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join('+');
}

/**
 * DEFAULT_HOTKEYS with the user's overrides from settings applied. An
 * override REPLACES the default chord list for that command id entirely
 * (not merged) — an explicit `[]` unbinds it. `close-tab` is dropped unless
 * running under Electron (`window.basalt`): in a plain browser tab Mod+W
 * closes the browser tab itself and preventDefault is unreliable there, so we
 * simply don't offer the binding rather than fight the browser over it.
 */
export function effectiveHotkeys(): Record<string, string[]> {
  const overrides = useSettings.getState().settings.hotkeys ?? {};
  const merged: Record<string, string[]> = { ...DEFAULT_HOTKEYS, ...overrides };
  const hasBasalt = typeof window !== 'undefined' && !!window.basalt;
  if (!hasBasalt) delete merged['close-tab'];
  return merged;
}

const MAC_SYMBOLS: Record<string, string> = {
  Mod: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

const NONMAC_NAMES: Record<string, string> = { Mod: 'Ctrl' };

/** Render a chord for display: `⌘⇧F` on Mac (no separator), `Ctrl+Shift+F` elsewhere. */
export function formatChord(chord: string): string {
  const parts = chord.split('+');
  if (isMac()) return parts.map((p) => MAC_SYMBOLS[p] ?? p).join('');
  return parts
    .map((p) => NONMAC_NAMES[p] ?? (p.startsWith('Arrow') ? p.slice('Arrow'.length) : p))
    .join('+');
}

// Never let a bound (or future) hotkey shadow the system clipboard/undo —
// these are not bound by DEFAULT_HOTKEYS, but a user override must not be
// able to shadow them either.
const NEVER_INTERCEPT = new Set(['Mod+C', 'Mod+V', 'Mod+X', 'Mod+Z', 'Mod+A']);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Install the app-wide hotkey listener (capture phase, so it runs before
 * CodeMirror/inputs see the event). Returns an uninstaller.
 *
 * While an overlay (quick switcher / command palette) is open its own search
 * input has focus; Mod+P / Mod+O still fire from here to switch overlays
 * (setOverlay just overwrites the current one), and Escape is deliberately
 * NOT bound here — the overlay components close themselves on Escape via
 * their own onKeyDown.
 */
export function installGlobalHotkeys(): () => void {
  const handler = (e: KeyboardEvent) => {
    const chord = eventToChord(e);
    if (!chord) return;
    if (NEVER_INTERCEPT.has(chord)) return;

    const tokens = chord.split('+');
    const hasModOrCtrl = tokens.includes('Mod') || tokens.includes('Ctrl');
    // A bare (or Alt/Shift-only) key while typing is just typing — only
    // Mod/Ctrl chords are allowed to interrupt an input/textarea/contenteditable.
    if (!hasModOrCtrl && isEditableTarget(e.target)) return;

    const hotkeys = effectiveHotkeys();
    const commandId = Object.keys(hotkeys).find((id) => hotkeys[id]?.includes(chord));
    if (!commandId) return;

    const command = listCommands().find((c) => c.id === commandId);
    if (!command) return;

    e.preventDefault();
    e.stopPropagation();
    void command.run();
  };

  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}
