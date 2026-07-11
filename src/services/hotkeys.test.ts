import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HOTKEYS, effectiveHotkeys, eventToChord, formatChord } from './hotkeys';
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
