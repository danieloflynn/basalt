import { syntaxTree } from '@codemirror/language';
import type { Extension, Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { wikilinkDisplayText } from '@/lib/wikilinks';

/**
 * Live Preview: hides markdown formatting characters except on the line the
 * cursor is on (Obsidian's behaviour), renders checkboxes as tappable boxes,
 * and collapses [[wikilinks]] to their display text.
 */

/** Node names whose text is pure syntax and should be hidden when inactive. */
const HIDDEN_MARKS = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'QuoteMark',
  'LinkMark',
  'URL',
]);

// Newlines excluded: Obsidian never treats a multi-line [[…]] as a link, and a
// pseudo-link that spanned lines used to collapse the line being edited.
const WIKILINK = /(!)?\[\[([^\[\]\n]+?)\]\]/g;
const HIGHLIGHT = /==([^=\n][^\n]*?)==/g;

/**
 * Nodes whose interior is verbatim (or otherwise not markdown): every REGEX pass
 * must skip them, or a `# comment` inside a shell fence renders as a giant
 * heading and YAML `- foo` inside frontmatter grows bullet dots + hanging
 * indent. (`Math*` are listed defensively for when a math extension is added.)
 */
const SKIP_NODES = new Set([
  'FencedCode',
  'CodeBlock',
  'InlineCode',
  'Frontmatter',
  'Math',
  'InlineMath',
  'BlockMath',
]);

class CheckboxWidget extends WidgetType {
  constructor(
    private checked: boolean,
    private pos: number,
  ) {
    super();
  }

  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.pos === this.pos;
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'lp-checkbox';
    box.dataset.checked = String(this.checked);
    box.setAttribute('aria-label', this.checked ? 'Mark as not done' : 'Mark as done');
    box.onmousedown = (e) => e.preventDefault();
    box.onclick = (e) => {
      e.preventDefault();
      const mark = this.checked ? ' ' : 'x';
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: mark } });
    };
    return box;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** Replaces a raw list marker (- * +) with a dimmed bullet dot, sized to 1ch
 *  so the surrounding column math (hanging indent) stays exact in the mono font. */
class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const dot = document.createElement('span');
    dot.className = 'lp-bullet';
    dot.textContent = '•';
    return dot;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class LinkTextWidget extends WidgetType {
  constructor(
    private display: string,
    private embed: boolean,
  ) {
    super();
  }

  override eq(other: LinkTextWidget): boolean {
    return other.display === this.display && other.embed === this.embed;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = this.embed ? 'lp-wikilink lp-wikilink--embed' : 'lp-wikilink';
    span.textContent = this.display;
    return span;
  }
}

export function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const { state } = view;
  const cursorLine = state.doc.lineAt(state.selection.main.head).number;

  const activeLines = new Set<number>();
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).number;
    const to = state.doc.lineAt(range.to).number;
    for (let l = from; l <= to; l++) activeLines.add(l);
  }
  activeLines.add(cursorLine);

  const tree = syntaxTree(state);

  for (const { from, to } of view.visibleRanges) {
    // Verbatim/non-markdown ranges (code, frontmatter, math) that EVERY regex
    // pass below must not decorate. Computed from the syntax tree per range.
    const skip: { from: number; to: number }[] = [];
    tree.iterate({
      from,
      to,
      enter(node) {
        if (SKIP_NODES.has(node.name)) skip.push({ from: node.from, to: node.to });
      },
    });
    const inSkip = (pos: number): boolean => {
      for (const r of skip) if (pos >= r.from && pos < r.to) return true;
      return false;
    };

    // 1. Syntax-tree marks (headings, emphasis, code, quotes). Already tree-driven
    //    so it never fires inside verbatim code (that content isn't parsed).
    tree.iterate({
      from,
      to,
      enter(node) {
        if (!HIDDEN_MARKS.has(node.name)) return;
        const line = state.doc.lineAt(node.from).number;
        if (activeLines.has(line)) return;
        if (node.name === 'HeaderMark') {
          // Hide the marker and the following space.
          const end = Math.min(node.to + 1, state.doc.lineAt(node.from).to);
          decorations.push(Decoration.replace({}).range(node.from, end));
        } else {
          decorations.push(Decoration.replace({}).range(node.from, node.to));
        }
      },
    });

    // 2. Regex-driven: wikilinks and highlights on inactive lines, gated by the
    //    syntax tree so code/frontmatter/math are left verbatim.
    const text = state.sliceDoc(from, to);

    for (const m of text.matchAll(WIKILINK)) {
      const start = from + m.index;
      if (inSkip(start)) continue;
      const line = state.doc.lineAt(start).number;
      if (activeLines.has(line)) continue;
      const inner = m[2];
      const pipe = inner.indexOf('|');
      const targetPart = pipe === -1 ? inner : inner.slice(0, pipe);
      const alias = pipe === -1 ? undefined : inner.slice(pipe + 1);
      const hash = targetPart.indexOf('#');
      const display = wikilinkDisplayText({
        target: hash === -1 ? targetPart : targetPart.slice(0, hash),
        heading: hash === -1 ? undefined : targetPart.slice(hash + 1),
        alias,
      });
      decorations.push(
        Decoration.replace({
          widget: new LinkTextWidget(display || inner, m[1] === '!'),
        }).range(start, start + m[0].length),
      );
    }

    for (const m of text.matchAll(HIGHLIGHT)) {
      const start = from + m.index;
      if (inSkip(start)) continue;
      const line = state.doc.lineAt(start).number;
      if (activeLines.has(line)) continue;
      decorations.push(Decoration.replace({}).range(start, start + 2));
      decorations.push(
        Decoration.mark({ class: 'lp-highlight' }).range(start + 2, start + m[0].length - 2),
      );
      decorations.push(
        Decoration.replace({}).range(start + m[0].length - 2, start + m[0].length),
      );
    }

    // 3. Heading lines: match reading view's display font (both modes get the
    //    line class here in live mode; source mode leans on the highlight style).
    for (const m of text.matchAll(/^(#{1,6})[ \t]/gm)) {
      const lineStart = from + m.index;
      if (inSkip(lineStart)) continue; // e.g. `# comment` inside a fenced code block
      const line = state.doc.lineAt(lineStart);
      if (line.from !== lineStart) continue; // partial match at a chunk edge
      decorations.push(Decoration.line({ class: `cm-lp-heading cm-lp-h${m[1].length}` }).range(lineStart));
    }

    // 4. List lines: bullets → dot, tasks → a single checkbox (marker hidden),
    //    ordered markers stay (dimmed by the highlight). Non-tab list lines get a
    //    hanging indent so wrapped text aligns past the marker.
    //    The task group accepts `- [ ]` at end-of-line (no trailing space).
    for (const m of text.matchAll(/^([ \t]*)([-*+]|\d+[.)])([ \t]+)(\[[ xX]\](?:[ \t]|$))?/gm)) {
      const [prefix, indent, marker, gap, task] = m;
      const lineStart = from + m.index;
      if (inSkip(lineStart)) continue; // e.g. YAML `- foo` inside frontmatter
      const line = state.doc.lineAt(lineStart);
      if (line.from !== lineStart) continue;
      const markerStart = lineStart + indent.length;
      const contentEnd = lineStart + prefix.length; // where the item text begins
      // ch is exact in the mono font ONLY for space indents; a tab is one char
      // but renders wide, so the hanging indent would over-hang. Skip it there.
      if (!indent.includes('\t')) {
        decorations.push(
          Decoration.line({
            class: 'cm-lp-list',
            attributes: { style: `padding-left:calc(2px + ${prefix.length}ch);text-indent:-${prefix.length}ch` },
          }).range(lineStart),
        );
      }
      if (activeLines.has(line.number)) continue;
      if (task) {
        const boxStart = markerStart + marker.length + gap.length;
        const checked = task[1] !== ' ';
        decorations.push(
          Decoration.replace({ widget: new CheckboxWidget(checked, boxStart) }).range(
            markerStart,
            contentEnd,
          ),
        );
        if (checked && contentEnd < line.to) {
          decorations.push(Decoration.mark({ class: 'lp-done' }).range(contentEnd, line.to));
        }
      } else if (marker === '-' || marker === '*' || marker === '+') {
        decorations.push(
          Decoration.replace({ widget: new BulletWidget() }).range(markerStart, markerStart + 1),
        );
      }
    }
  }

  return Decoration.set(
    decorations.sort((x, y) => x.from - y.from || x.to - y.to),
    true,
  );
}

export function livePreview(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view);
        }

        update(u: ViewUpdate) {
          if (u.docChanged || u.selectionSet || u.viewportChanged) {
            this.decorations = buildDecorations(u.view);
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    livePreviewTheme,
  ];
}

const livePreviewTheme = EditorView.baseTheme({
  '.lp-wikilink': {
    color: 'var(--link)',
    backgroundColor: 'var(--link-soft)',
    borderRadius: '4px',
    padding: '0.05em 0.3em',
  },
  '.lp-wikilink--embed::before': {
    content: "'⧉ '",
    opacity: 0.7,
  },
  '.lp-highlight': {
    backgroundColor: 'var(--ember-soft)',
    borderRadius: '3px',
  },
  '.lp-done': {
    color: 'var(--text-faint)',
    textDecoration: 'line-through',
  },
  '.lp-bullet': {
    display: 'inline-block',
    width: '1ch',
    textAlign: 'center',
    color: 'var(--text-muted)',
  },
  '.lp-checkbox': {
    display: 'inline-block',
    width: '1.1em',
    height: '1.1em',
    marginRight: '0.4em',
    verticalAlign: 'text-bottom',
    border: '1.5px solid var(--border-strong)',
    borderRadius: '5px',
    background: 'var(--surface)',
    cursor: 'pointer',
    padding: '0',
  },
  '.lp-checkbox[data-checked="true"]': {
    background: 'var(--ember)',
    borderColor: 'var(--ember)',
  },
  // Heading lines match the reading view's display type so toggling modes
  // doesn't shift the font (parity with `.md h1…h6` in markdown.css).
  '.cm-lp-heading': {
    fontFamily: 'var(--font-display)',
    fontWeight: '580',
    lineHeight: '1.25',
    letterSpacing: '0.005em',
  },
  '.cm-lp-h1': { fontSize: 'var(--text-2xl)' },
  '.cm-lp-h2': { fontSize: 'var(--text-xl)' },
  '.cm-lp-h3': { fontSize: 'var(--text-lg)' },
  '.cm-lp-h4, .cm-lp-h5, .cm-lp-h6': { fontSize: 'var(--text-body)' },
});
