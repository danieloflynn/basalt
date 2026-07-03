import { highlightingFor } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';
import { basaltHighlight, basaltHighlightStyle } from './theme';

/**
 * @lezer/markdown tags a link inside a list item with BOTH tags.list and
 * tags.link (the "BulletList/..." descendant rule), so both color classes land
 * on the same span. HighlightStyle emits rules in array order and equal-
 * specificity ties go to the LATER rule — so the link rule MUST come after the
 * list rule for links in checkbox/list items to stay celadon (fix #11).
 */
describe('basaltHighlight cascade order', () => {
  it('defines the link color rule AFTER the list color rule', () => {
    const state = EditorState.create({ doc: 'x', extensions: [basaltHighlight] });
    const linkCls = highlightingFor(state, [tags.link]);
    const listCls = highlightingFor(state, [tags.list]);
    expect(linkCls).toBeTruthy();
    expect(listCls).toBeTruthy();

    const css: string = (basaltHighlightStyle as unknown as { module: { getRules(): string } }).module.getRules();
    const linkAt = css.indexOf(`.${linkCls} `);
    const listAt = css.indexOf(`.${listCls} `);
    expect(linkAt).toBeGreaterThan(-1);
    expect(listAt).toBeGreaterThan(-1);
    // Later rule wins the tie → link must appear after list.
    expect(linkAt).toBeGreaterThan(listAt);
  });
});
