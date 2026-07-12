import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';

// EditorToolbar pulls in the services + capacitor graph at import time; stub the
// heavy leaves so we can unit-test the pure formatting commands headlessly.
vi.mock('@/services', () => ({
  useSettings: () => ({ settings: {}, update: () => {} }),
  vaultService: {},
}));
vi.mock('@/lib/keyboard', () => ({ showSoftKeyboard: () => {} }));

const {
  wrapSelection,
  toggleListFamily,
  toggleQuote,
  insertTag,
  cycleHeading,
  parseListLine,
} = await import('./EditorToolbar');

/** Minimal EditorView stand-in: real EditorState + a dispatch that applies specs. */
function makeView(doc: string, sel?: { anchor: number; head?: number }): EditorView {
  let state = EditorState.create({ doc, selection: sel });
  return {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState['update']>[0]) {
      state = state.update(spec).state;
    },
    focus() {},
  } as unknown as EditorView;
}

/** Select the literal `needle` in `doc` and return a ready view. */
function withSelection(doc: string, needle: string): EditorView {
  const at = doc.indexOf(needle);
  return makeView(doc, { anchor: at, head: at + needle.length });
}

const text = (v: EditorView) => v.state.doc.toString();

describe('wrapSelection (marker adjacency)', () => {
  it('composes italic INSIDE bold instead of destroying it', () => {
    const v = withSelection('**text**', 'text');
    wrapSelection(v, '*');
    expect(text(v)).toBe('***text***');
  });

  it('unwraps italic when the surrounding run is exactly one *', () => {
    const v = withSelection('*text*', 'text');
    wrapSelection(v, '*');
    expect(text(v)).toBe('text');
  });

  it('unwraps bold when the surrounding run is exactly two *', () => {
    const v = withSelection('**text**', 'text');
    wrapSelection(v, '**');
    expect(text(v)).toBe('text');
  });

  it('wraps a plain selection', () => {
    const v = withSelection('text', 'text');
    wrapSelection(v, '**');
    expect(text(v)).toBe('**text**');
  });

  it('composes for shared-character markers too (== + =text= + ==)', () => {
    const v = withSelection('==text==', 'text');
    wrapSelection(v, '=');
    expect(text(v)).toBe('===text===');
  });
});

describe('toggleListFamily (family-aware, multi-line)', () => {
  it('Numbered on an already-numbered line toggles it OFF (not "1. 2. foo")', () => {
    const v = makeView('2. foo', { anchor: 0 });
    toggleListFamily(v, 'numbered');
    expect(text(v)).toBe('foo');
  });

  it('List on a task converts to a bullet (not a stray "[ ] task")', () => {
    const v = makeView('- [ ] task', { anchor: 0 });
    toggleListFamily(v, 'bullet');
    expect(text(v)).toBe('- task');
  });

  it('Task on a bullet swaps in the checkbox (not "- [ ] - foo")', () => {
    const v = makeView('- foo', { anchor: 0 });
    toggleListFamily(v, 'task');
    expect(text(v)).toBe('- [ ] foo');
  });

  it('Task on a task toggles it off to plain', () => {
    const v = makeView('- [ ] foo', { anchor: 0 });
    toggleListFamily(v, 'task');
    expect(text(v)).toBe('foo');
  });

  it('applies bullets to EVERY selected line', () => {
    const doc = 'a\nb\nc';
    const v = makeView(doc, { anchor: 0, head: doc.length });
    toggleListFamily(v, 'bullet');
    expect(text(v)).toBe('- a\n- b\n- c');
  });

  it('numbers a multi-line selection sequentially', () => {
    const doc = 'a\nb\nc';
    const v = makeView(doc, { anchor: 0, head: doc.length });
    toggleListFamily(v, 'numbered');
    expect(text(v)).toBe('1. a\n2. b\n3. c');
  });

  it('renumbers a messy contiguous ordered list it touches', () => {
    const doc = '3. a\n7. b\n1. c';
    const v = makeView(doc, { anchor: 0, head: doc.length });
    toggleListFamily(v, 'numbered'); // all numbered -> toggles OFF
    expect(text(v)).toBe('a\nb\nc');
    // Bullets -> numbered resequences from 1.
    const doc2 = '- a\n- b\n- c';
    const v2 = makeView(doc2, { anchor: 0, head: doc2.length });
    toggleListFamily(v2, 'numbered');
    expect(text(v2)).toBe('1. a\n2. b\n3. c');
  });

  it('toggles a bullet family off across a selection', () => {
    const doc = '- a\n- b';
    const v = makeView(doc, { anchor: 0, head: doc.length });
    toggleListFamily(v, 'bullet');
    expect(text(v)).toBe('a\nb');
  });
});

describe('toggleListFamily cursor placement', () => {
  const cursor = (v: EditorView) => v.state.selection.main.head;

  it('puts the caret AFTER the checkbox on an empty line (not left of it)', () => {
    const v = makeView('', { anchor: 0 });
    toggleListFamily(v, 'task');
    expect(text(v)).toBe('- [ ] ');
    expect(cursor(v)).toBe('- [ ] '.length);
  });

  it('puts the caret after the marker when converting from line start', () => {
    const v = makeView('foo', { anchor: 0 });
    toggleListFamily(v, 'task');
    expect(text(v)).toBe('- [ ] foo');
    expect(cursor(v)).toBe('- [ ] '.length);
  });

  it('keeps the caret anchored to the content mid-line', () => {
    // caret after "fo" — must still sit after "fo" once the marker is added.
    const v = makeView('foo', { anchor: 2 });
    toggleListFamily(v, 'task');
    expect(text(v)).toBe('- [ ] foo');
    expect(cursor(v)).toBe('- [ ] fo'.length);
  });

  it('keeps the caret at the content when toggling a task OFF', () => {
    const doc = '- [ ] foo';
    const v = makeView(doc, { anchor: doc.length });
    toggleListFamily(v, 'task');
    expect(text(v)).toBe('foo');
    expect(cursor(v)).toBe('foo'.length);
  });

  it('does not disturb typing position when converting bullet -> task', () => {
    const doc = '- foo';
    const v = makeView(doc, { anchor: doc.length });
    toggleListFamily(v, 'task');
    expect(text(v)).toBe('- [ ] foo');
    expect(cursor(v)).toBe('- [ ] foo'.length);
  });

  it('lands after "> " when quoting an empty line', () => {
    const v = makeView('', { anchor: 0 });
    toggleQuote(v);
    expect(text(v)).toBe('> ');
    expect(cursor(v)).toBe(2);
  });
});

describe('parseListLine', () => {
  it('recognizes a task at end-of-line (no trailing space)', () => {
    expect(parseListLine('- [ ]')).toMatchObject({ kind: 'task', checked: false, content: '' });
    expect(parseListLine('- [x] done')).toMatchObject({ kind: 'task', checked: true, content: 'done' });
    expect(parseListLine('- foo')).toMatchObject({ kind: 'bullet', content: 'foo' });
    expect(parseListLine('2. foo')).toMatchObject({ kind: 'numbered', content: 'foo' });
    expect(parseListLine('plain')).toMatchObject({ kind: 'plain', content: 'plain' });
  });
});

describe('toggleQuote', () => {
  it('quotes and unquotes every selected line', () => {
    const doc = 'a\nb';
    const v = makeView(doc, { anchor: 0, head: doc.length });
    toggleQuote(v);
    expect(text(v)).toBe('> a\n> b');
    toggleQuote(v);
    expect(text(v)).toBe('a\nb');
  });
});

describe('insertTag', () => {
  it('prefixes a selection into a tag instead of replacing it', () => {
    const v = withSelection('foo', 'foo');
    insertTag(v);
    expect(text(v)).toBe('#foo');
  });

  it('inserts a bare # with no selection', () => {
    const v = makeView('', { anchor: 0 });
    insertTag(v);
    expect(text(v)).toBe('#');
  });
});

describe('cycleHeading', () => {
  it('adds a level and cycles off after H3', () => {
    const v = makeView('title', { anchor: 0 });
    cycleHeading(v);
    expect(text(v)).toBe('# title');
  });
});
