import { CompletionContext, type Completion } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';

// vaultService.linkTargets() drives the option list; stub a single note.
vi.mock('@/services', () => ({
  vaultService: { linkTargets: () => [{ title: 'Note', path: 'Note.md' }] },
}));

const { wikilinkCompletions } = await import('./wikilinkComplete');

function makeView(doc: string, anchor: number): EditorView {
  let state = EditorState.create({ doc, selection: { anchor } });
  return {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState['update']>[0]) {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
}

/** Run the completion source at `caret` and apply the (only) option. */
function complete(doc: string, caret: number): string {
  const state = EditorState.create({ doc, selection: { anchor: caret } });
  const result = wikilinkCompletions(new CompletionContext(state, caret, true));
  if (!result) throw new Error('no completion');
  const option = result.options[0];
  const view = makeView(doc, caret);
  const { apply } = option;
  if (typeof apply !== 'function') throw new Error('expected a function apply');
  apply(view, option as Completion, result.from, caret);
  return view.state.doc.toString();
}

describe('wikilink completion (mid-link)', () => {
  it('replaces the target only, leaving |alias]] intact', () => {
    // caret right after "No", before the pipe.
    expect(complete('[[No|alias]]', 4)).toBe('[[Note|alias]]');
  });

  it('does not insert a second ]] when the link is already closed', () => {
    expect(complete('[[Not]]', 5)).toBe('[[Note]]');
  });

  it('replaces through an existing target when completing in its middle', () => {
    // caret after "No" inside "[[Note]]"
    expect(complete('[[Note]]', 4)).toBe('[[Note]]');
  });

  it('closes an unclosed link', () => {
    expect(complete('[[No', 4)).toBe('[[Note]]');
  });
});
