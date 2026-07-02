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

const WIKILINK = /(!)?\[\[([^\[\]]+?)\]\]/g;
const HIGHLIGHT = /==([^=\n][^\n]*?)==/g;

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

function buildDecorations(view: EditorView): DecorationSet {
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

  for (const { from, to } of view.visibleRanges) {
    // 1. Syntax-tree marks (headings, emphasis, code, quotes).
    syntaxTree(state).iterate({
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

    // 2. Regex-driven: wikilinks, highlights, checkboxes on inactive lines.
    const text = state.sliceDoc(from, to);

    for (const m of text.matchAll(WIKILINK)) {
      const start = from + m.index;
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

    for (const m of text.matchAll(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]\s/gm)) {
      const boxStart = from + m.index + m[1].length;
      const line = state.doc.lineAt(boxStart).number;
      if (activeLines.has(line)) continue;
      decorations.push(
        Decoration.replace({
          widget: new CheckboxWidget(m[2] !== ' ', boxStart),
        }).range(boxStart, boxStart + 3),
      );
      if (m[2] !== ' ') {
        const lineEnd = state.doc.lineAt(boxStart).to;
        decorations.push(
          Decoration.mark({ class: 'lp-done' }).range(boxStart + 4, lineEnd),
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
  '.lp-checkbox': {
    display: 'inline-block',
    width: '1.1em',
    height: '1.1em',
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
});
