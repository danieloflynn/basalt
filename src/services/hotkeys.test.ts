import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the vi.mock factory below (which is itself hoisted above these
// imports) can close over it. Only the setHotkeyCapture suite uses this —
// installGlobalHotkeys calls the REAL listCommands() everywhere else, but
// that pulls in vaultService/useNav/JSX icons, which is more than we want to
// stand up just to prove one command's run() fired (or didn't).
const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));
vi.mock('@/commands/registry', () => ({
  listCommands: () => [{ id: 'test-cmd', name: 'Test command', run: mockRun }],
}));

import {
  addBinding,
  DEFAULT_HOTKEYS,
  effectiveHotkeys,
  eventToChord,
  formatChord,
  installGlobalHotkeys,
  isOverridden,
  removeBinding,
  resetBinding,
  setHotkeyCapture,
} from './hotkeys';
import { useSettings } from './settings';

/** Minimal KeyboardEvent stand-in — real KeyboardEvent isn't constructible here (no DOM). */
function key(
  k: string,
  mods: Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>> = {},
): KeyboardEvent {
  return {
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    // installGlobalHotkeys' handler calls these on a match — no-ops here since
    // there's no real DOM event to affect.
    preventDefault: () => {},
    stopPropagation: () => {},
    ...mods,
  } as unknown as KeyboardEvent;
}

const mac = () => vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Macintosh' });
const windows = () => vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows' });

describe('eventToChord', () => {
  beforeEach(mac);
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes a plain Mod+letter, uppercasing single characters', () => {
    expect(eventToChord(key('p', { metaKey: true }))).toBe('Mod+P');
  });

  it('normalizes a Mod+Shift+letter chord', () => {
    expect(eventToChord(key('F', { metaKey: true, shiftKey: true }))).toBe('Mod+Shift+F');
  });

  it('keeps arrow keys verbatim, in fixed Mod+Ctrl+Alt+Shift+Key order', () => {
    expect(eventToChord(key('ArrowLeft', { metaKey: true, altKey: true }))).toBe(
      'Mod+Alt+ArrowLeft',
    );
  });

  it('leaves comma untouched by the uppercasing rule', () => {
    expect(eventToChord(key(',', { metaKey: true }))).toBe('Mod+,');
  });

  it('ignores a bare-modifier keydown (nothing to bind)', () => {
    expect(eventToChord(key('Meta', { metaKey: true }))).toBeNull();
    expect(eventToChord(key('Shift', { shiftKey: true }))).toBeNull();
  });

  it('uses ctrlKey (not metaKey) for Mod on non-Mac platforms', () => {
    windows();
    expect(eventToChord(key('p', { ctrlKey: true }))).toBe('Mod+P');
    expect(eventToChord(key('p', { metaKey: true }))).toBe('P'); // metaKey isn't Mod here
  });
});

describe('effectiveHotkeys', () => {
  afterEach(() => {
    useSettings.setState((s) => ({ settings: { ...s.settings, hotkeys: {} } }));
  });

  it('falls back to DEFAULT_HOTKEYS with no user overrides', () => {
    expect(effectiveHotkeys()['open-command-palette']).toEqual(
      DEFAULT_HOTKEYS['open-command-palette'],
    );
    expect(effectiveHotkeys()['open-quick-switcher']).toEqual(['Mod+O']);
  });

  it('a user override REPLACES the default chord list for that command', () => {
    useSettings.setState((s) => ({
      settings: { ...s.settings, hotkeys: { 'open-command-palette': ['Mod+K'] } },
    }));
    expect(effectiveHotkeys()['open-command-palette']).toEqual(['Mod+K']);
    // untouched commands keep their default
    expect(effectiveHotkeys()['open-quick-switcher']).toEqual(['Mod+O']);
  });

  it('an explicit empty array unbinds a command entirely', () => {
    useSettings.setState((s) => ({ settings: { ...s.settings, hotkeys: { graph: [] } } }));
    expect(effectiveHotkeys().graph).toEqual([]);
  });

  it('omits close-tab when window.basalt is absent (plain browser tab)', () => {
    expect(typeof window === 'undefined' || !window.basalt).toBe(true);
    expect(effectiveHotkeys()['close-tab']).toBeUndefined();
  });

  it('keeps close-tab when running under Electron (window.basalt present)', () => {
    vi.stubGlobal('window', { basalt: {} });
    expect(effectiveHotkeys()['close-tab']).toEqual(['Mod+W']);
    vi.unstubAllGlobals();
  });
});

describe('formatChord', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders Mac symbols with no separator', () => {
    mac();
    expect(formatChord('Mod+Shift+F')).toBe('⌘⇧F');
    expect(formatChord('Mod+Alt+ArrowLeft')).toBe('⌘⌥←');
    expect(formatChord('Mod+,')).toBe('⌘,');
  });

  it('renders Ctrl/Shift names joined with + on non-Mac platforms', () => {
    windows();
    expect(formatChord('Mod+Shift+F')).toBe('Ctrl+Shift+F');
  });
});

describe('addBinding', () => {
  it('starts from the default list when no override exists, appending the new chord', () => {
    expect(addBinding({}, 'graph', 'Mod+Shift+G')).toEqual({
      graph: ['Mod+G', 'Mod+Shift+G'],
    });
  });

  it('appends to an existing override rather than the default', () => {
    expect(addBinding({ graph: ['Mod+1'] }, 'graph', 'Mod+2')).toEqual({
      graph: ['Mod+1', 'Mod+2'],
    });
  });

  it('does not add a duplicate chord', () => {
    expect(addBinding({}, 'graph', 'Mod+G')).toEqual({ graph: ['Mod+G'] });
    expect(addBinding({ graph: ['Mod+1'] }, 'graph', 'Mod+1')).toEqual({ graph: ['Mod+1'] });
  });

  it('leaves other commands untouched', () => {
    expect(addBinding({ sync: ['Mod+S'] }, 'graph', 'Mod+Shift+G')).toEqual({
      sync: ['Mod+S'],
      graph: ['Mod+G', 'Mod+Shift+G'],
    });
  });

  it('starts from an explicitly-unbound ([]) override rather than reviving the default', () => {
    expect(addBinding({ daily: [] }, 'daily', 'Mod+D')).toEqual({ daily: ['Mod+D'] });
  });
});

describe('removeBinding', () => {
  it('removes a chord out of the default list, writing an explicit override', () => {
    expect(removeBinding({}, 'go-back', 'Mod+Alt+ArrowLeft')).toEqual({ 'go-back': [] });
  });

  it('removes a chord from an existing override', () => {
    expect(removeBinding({ graph: ['Mod+1', 'Mod+2'] }, 'graph', 'Mod+1')).toEqual({
      graph: ['Mod+2'],
    });
  });

  it('writes an override down to [] (explicitly unbound) when it was the only chord', () => {
    expect(removeBinding({}, 'graph', 'Mod+G')).toEqual({ graph: [] });
  });

  it('still writes a (value-unchanged) override entry when the chord was not present', () => {
    expect(removeBinding({}, 'graph', 'Mod+X')).toEqual({ graph: ['Mod+G'] });
  });
});

describe('resetBinding', () => {
  it('removes the override key so the default applies again', () => {
    expect(resetBinding({ graph: [], sync: ['Mod+S'] }, 'graph')).toEqual({ sync: ['Mod+S'] });
  });

  it('is a no-op if there was no override for the id', () => {
    expect(resetBinding({ sync: ['Mod+S'] }, 'graph')).toEqual({ sync: ['Mod+S'] });
  });
});

describe('isOverridden', () => {
  it('is false when there is no entry for the id', () => {
    expect(isOverridden({}, 'graph')).toBe(false);
  });

  it('is true for an explicit entry, even an empty (unbound) array', () => {
    expect(isOverridden({ graph: [] }, 'graph')).toBe(true);
    expect(isOverridden({ graph: ['Mod+G'] }, 'graph')).toBe(true);
  });
});

describe('setHotkeyCapture', () => {
  beforeEach(() => {
    mac();
    mockRun.mockClear();
    useSettings.setState((s) => ({
      settings: { ...s.settings, hotkeys: { 'test-cmd': ['Mod+K'] } },
    }));
  });

  afterEach(() => {
    setHotkeyCapture(false);
    vi.unstubAllGlobals();
    useSettings.setState((s) => ({ settings: { ...s.settings, hotkeys: {} } }));
  });

  it('suppresses installGlobalHotkeys\' handler while capturing is on, resuming once off', () => {
    // No DOM here (see the file-top comment on `key()`), so stub just enough
    // of `window` for installGlobalHotkeys to register — capturing the
    // handler it attaches so we can drive it directly.
    let handler: ((e: KeyboardEvent) => void) | undefined;
    vi.stubGlobal('window', {
      addEventListener: (_type: string, fn: EventListener) => {
        handler = fn as (e: KeyboardEvent) => void;
      },
      removeEventListener: () => {},
    });

    const uninstall = installGlobalHotkeys();
    expect(handler).toBeDefined();

    // Mod+K is bound to our mocked 'test-cmd' via the override above.
    handler!(key('k', { metaKey: true }));
    expect(mockRun).toHaveBeenCalledTimes(1);

    setHotkeyCapture(true);
    handler!(key('k', { metaKey: true }));
    expect(mockRun).toHaveBeenCalledTimes(1); // suppressed — no second call

    setHotkeyCapture(false);
    handler!(key('k', { metaKey: true }));
    expect(mockRun).toHaveBeenCalledTimes(2); // resumes once capturing is off

    uninstall();
  });
});
