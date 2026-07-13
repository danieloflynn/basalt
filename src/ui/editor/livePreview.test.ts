import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { buildDecorations } from './livePreview';
import { frontmatter } from './frontmatter';

interface DecoInfo {
  from: number;
  to: number;
  widget?: string;
  cls?: string;
  style?: string;
}

/** Build the live-preview decorations for `doc`, cursor parked at `cursor`. */
function decorate(doc: string, cursor = 0): { doc: string; items: DecoInfo[]; lineOf: (n: number) => { from: number; to: number } } {
  const state = EditorState.create({
    doc,
    selection: { anchor: Math.min(cursor, doc.length) },
    extensions: [markdown({ base: markdownLanguage, extensions: [frontmatter] })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const view = { state, visibleRanges: [{ from: 0, to: state.doc.length }] } as unknown as EditorView;
  const set = buildDecorations(view);
  const items: DecoInfo[] = [];
  const cur = set.iter();
  while (cur.value) {
    const spec = cur.value.spec as { widget?: { constructor: { name: string } }; class?: string; attributes?: { style?: string } };
    items.push({
      from: cur.from,
      to: cur.to,
      widget: spec.widget?.constructor.name,
      cls: spec.class,
      style: spec.attributes?.style,
    });
    cur.next();
  }
  const lineOf = (n: number) => {
    const l = state.doc.line(n);
    return { from: l.from, to: l.to };
  };
  return { doc, items, lineOf };
}

/** Decorations intersecting line number `n`. */
function onLine(r: ReturnType<typeof decorate>, n: number): DecoInfo[] {
  const { from, to } = r.lineOf(n);
  return r.items.filter((d) => d.from >= from && d.from <= to);
}

describe('livePreview decorations gated by the syntax tree', () => {
  it('does NOT render a heading for a `# comment` inside a fenced code block', () => {
    const r = decorate('# Real\n\n```sh\n# not a heading\n```\n', 0);
    // The real heading (line 1) gets the heading class...
    expect(onLine(r, 1).some((d) => d.cls?.includes('cm-lp-heading'))).toBe(true);
    // ...but the `# not a heading` line inside the fence (line 4) does not.
    expect(onLine(r, 4).some((d) => d.cls?.includes('cm-lp-heading'))).toBe(false);
  });

  it('does NOT bullet a YAML `- foo` line inside frontmatter', () => {
    const r = decorate('---\ntags:\n  - foo\n---\nbody\n', 22);
    const fmLine = onLine(r, 3); // "  - foo" inside the frontmatter block
    expect(fmLine.some((d) => d.widget === 'BulletWidget')).toBe(false);
    expect(fmLine.some((d) => d.style?.includes('text-indent'))).toBe(false);
  });

  it('bullets a real list line (positive control)', () => {
    const r = decorate('x\n- foo\n', 0);
    expect(onLine(r, 2).some((d) => d.widget === 'BulletWidget')).toBe(true);
  });
});

describe('livePreview wikilinks', () => {
  it('does NOT collapse a [[…]] that spans a newline', () => {
    const across = decorate('x\n[[foo\nbar]]\n', 0);
    expect(across.items.some((d) => d.widget === 'LinkTextWidget')).toBe(false);
    const single = decorate('x\n[[foobar]]\n', 0);
    expect(single.items.some((d) => d.widget === 'LinkTextWidget')).toBe(true);
  });

  it('renders a wikilink pill inside a task-list item (fix #11)', () => {
    const r = decorate('x\n- [ ] see [[Note]] now\n', 0);
    const line2 = onLine(r, 2);
    expect(line2.some((d) => d.widget === 'CheckboxWidget')).toBe(true);
    expect(line2.some((d) => d.widget === 'LinkTextWidget')).toBe(true);
  });

  it('skips a [[…]] inside inline code', () => {
    const r = decorate('x\n`[[Note]]` text\n', 0);
    expect(r.items.some((d) => d.widget === 'LinkTextWidget')).toBe(false);
  });
});

describe('livePreview checkboxes and indentation', () => {
  it('renders a checkbox for `- [ ]` at end-of-line (fix #9c)', () => {
    const r = decorate('x\n- [ ]', 0);
    const line2 = onLine(r, 2);
    expect(line2.some((d) => d.widget === 'CheckboxWidget')).toBe(true);
    expect(line2.some((d) => d.widget === 'BulletWidget')).toBe(false);
  });

  it('omits the ch-based hanging indent on tab-indented list lines (fix #9d)', () => {
    const tabbed = decorate('x\n\t- foo\n', 0);
    expect(onLine(tabbed, 2).some((d) => d.style?.includes('text-indent'))).toBe(false);
    // Space-indented lines still get the hanging indent.
    const spaced = decorate('x\n  - foo\n', 0);
    expect(onLine(spaced, 2).some((d) => d.style?.includes('text-indent'))).toBe(true);
  });
});

describe('livePreview raw links', () => {
  // Cursor parked on line 1; the link lives on line 3 (inactive).
  const CURSOR_AWAY = 'cursor here\n\n';

  it('keeps a bare pasted https:// URL visible on an inactive line', () => {
    const url = 'https://example.com/some/page';
    const r = decorate(`${CURSOR_AWAY}${url}\n`, 0);
    const covering = onLine(r, 3).filter((d) => d.to > d.from && !d.widget && !d.cls);
    // No replace decoration may swallow the autolink — it IS the visible text.
    expect(covering).toEqual([]);
  });

  it('keeps an <angle-bracket> autolink URL visible, hiding only the brackets', () => {
    const r = decorate(`${CURSOR_AWAY}<https://example.com>\n`, 0);
    const line = r.lineOf(3);
    const urlStart = r.doc.indexOf('https://example.com');
    const hidden = onLine(r, 3).filter((d) => d.to > d.from && !d.widget && !d.cls);
    // Whatever is hidden on the line must not overlap the URL text itself.
    for (const d of hidden) {
      expect(d.to <= urlStart || d.from >= urlStart + 'https://example.com'.length).toBe(true);
    }
    expect(line.to - line.from).toBeGreaterThan(0);
  });

  it('still hides the (url) part of a [text](url) link on an inactive line', () => {
    const doc = `${CURSOR_AWAY}[site](https://example.com)\n`;
    const r = decorate(doc, 0);
    const urlStart = doc.indexOf('https://example.com');
    expect(
      onLine(r, 3).some((d) => !d.widget && d.from <= urlStart && d.to >= urlStart + 5),
    ).toBe(true);
  });
});
