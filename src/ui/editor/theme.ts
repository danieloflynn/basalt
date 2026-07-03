import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { frontmatterContent, frontmatterMark } from './frontmatter';

/** CodeMirror theme driven by the app's CSS variables, so it follows dark/light automatically. */
export const basaltEditorTheme = EditorView.theme({
  '&': {
    fontSize: 'var(--text-body)',
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: 1.65,
    padding: '12px var(--pad-screen) 50vh',
    overscrollBehavior: 'contain',
  },
  '.cm-content': {
    caretColor: 'var(--ember)',
    maxWidth: '100%',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--ember)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--ember-soft) !important',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-line': { padding: '0 2px' },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface-raised)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)',
    boxShadow: 'var(--shadow-raised)',
    overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete': {
    '& > ul': {
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--text-md)',
      maxHeight: '14em',
    },
    '& > ul > li': {
      padding: '9px 14px',
    },
    '& > ul > li[aria-selected]': {
      backgroundColor: 'var(--ember-soft)',
      color: 'var(--text)',
    },
  },
});

export const basaltHighlightStyle = HighlightStyle.define([
    // Match the reading view (`.md h1…h6`): display font, weight, token sizes —
    // so headings don't change font when toggling live/source/reading.
    { tag: tags.heading1, fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', fontWeight: '580' },
    { tag: tags.heading2, fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: '580' },
    { tag: tags.heading3, fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: '580' },
    {
      tag: [tags.heading4, tags.heading5, tags.heading6],
      fontFamily: 'var(--font-display)',
      fontSize: 'var(--text-body)',
      fontWeight: '580',
    },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--text-faint)' },
    { tag: tags.monospace, color: 'var(--ember)', fontSize: '0.9em' },
    { tag: tags.quote, color: 'var(--text-muted)', fontStyle: 'italic' },
    { tag: tags.list, color: 'var(--text-muted)' },
    // link/url are defined AFTER list/quote ON PURPOSE. @lezer/markdown assigns
    // BOTH tags.list and tags.link to a link inside a list item (via the
    // "BulletList/..." descendant rule), so the two color classes land on the
    // same span. HighlightStyle emits rules in array order and equal-specificity
    // ties go to the LATER rule — so link must come last to stay celadon inside
    // checkbox/list items instead of being muted to look like plain text.
    { tag: tags.link, color: 'var(--link)' },
    { tag: tags.url, color: 'var(--link)', opacity: 0.8 },
    { tag: tags.meta, color: 'var(--text-faint)' },
    { tag: tags.processingInstruction, color: 'var(--text-faint)' },
    { tag: tags.labelName, color: 'var(--link)' },
    { tag: tags.comment, color: 'var(--text-faint)', fontStyle: 'italic' },
    { tag: tags.keyword, color: 'var(--ember)' },
    { tag: tags.string, color: 'var(--link)' },
    // Frontmatter (Obsidian source-mode look): quiet, monospace — never the
    // display face. The mono is explicit so no inherited heading style leaks in.
    { tag: frontmatterContent, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' },
    { tag: frontmatterMark, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' },
  ]);

export const basaltHighlight = syntaxHighlighting(basaltHighlightStyle);
