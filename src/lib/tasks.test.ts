import { describe, expect, it } from 'vitest';
import { applyTaskSort, sortToggledTask, toggleTaskAtLine } from './tasks';

/** Toggle line `n`, sort, and return the resulting full text. */
function toggleAndSort(text: string, n: number): string {
  const toggled = toggleTaskAtLine(text, n);
  expect(toggled).not.toBeNull();
  const region = sortToggledTask(toggled!, n);
  return region ? applyTaskSort(toggled!, region) : toggled!;
}

describe('toggleTaskAtLine', () => {
  it('flips unchecked to checked and back', () => {
    expect(toggleTaskAtLine('- [ ] a', 1)).toBe('- [x] a');
    expect(toggleTaskAtLine('- [x] a', 1)).toBe('- [ ] a');
  });

  it('returns null on non-task lines', () => {
    expect(toggleTaskAtLine('- a', 1)).toBeNull();
    expect(toggleTaskAtLine('text', 1)).toBeNull();
  });
});

describe('sortToggledTask — checking sinks to the bottom', () => {
  it('moves a just-checked item below its unchecked siblings', () => {
    expect(toggleAndSort('- [ ] a\n- [ ] b\n- [ ] c', 1)).toBe('- [ ] b\n- [ ] c\n- [x] a');
  });

  it('is a no-op when the checked item is already last', () => {
    const toggled = toggleTaskAtLine('- [ ] a\n- [ ] b', 2)!;
    expect(sortToggledTask(toggled, 2)).toBeNull();
  });

  it('is a no-op for a single-item list', () => {
    expect(sortToggledTask('- [x] only', 1)).toBeNull();
  });

  it('sinks below already-checked items too (bottom of the whole group)', () => {
    expect(toggleAndSort('- [ ] a\n- [ ] b\n- [x] c', 1)).toBe('- [ ] b\n- [x] c\n- [x] a');
  });

  it('moves the item with its indented subtree', () => {
    const src = '- [ ] a\n  - [ ] a-child\n  note line\n- [ ] b';
    expect(toggleAndSort(src, 1)).toBe('- [ ] b\n- [x] a\n  - [ ] a-child\n  note line');
  });

  it('only rearranges siblings at the same indent (nested list stays put)', () => {
    const src = '- [ ] top\n  - [ ] n1\n  - [ ] n2\n- [ ] last';
    // Checking n1 (line 2) sinks it below n2 but keeps it inside the sublist.
    expect(toggleAndSort(src, 2)).toBe('- [ ] top\n  - [ ] n2\n  - [x] n1\n- [ ] last');
  });

  it('keeps loose lists loose (single blank line between items)', () => {
    const src = '- [ ] a\n\n- [ ] b\n\n- [ ] c';
    expect(toggleAndSort(src, 1)).toBe('- [ ] b\n\n- [ ] c\n\n- [x] a');
  });

  it('does not cross a group boundary (two blank lines / other content)', () => {
    const src = '- [ ] a\n- [ ] b\n\n\n- [ ] other list';
    expect(toggleAndSort(src, 1)).toBe('- [ ] b\n- [x] a\n\n\n- [ ] other list');
  });

  it('stays inside its own list when paragraphs surround it', () => {
    const src = 'intro\n\n- [ ] a\n- [ ] b\n\nafter';
    expect(toggleAndSort(src, 3)).toBe('intro\n\n- [ ] b\n- [x] a\n\nafter');
  });

  it('treats plain bullets as unchecked content and sinks below them', () => {
    expect(toggleAndSort('- [ ] a\n- plain\n- [ ] c', 1)).toBe('- plain\n- [ ] c\n- [x] a');
  });

  it('renumbers a fully numbered task group after the move', () => {
    expect(toggleAndSort('1. [ ] a\n2. [ ] b\n3. [ ] c', 1)).toBe(
      '1. [ ] b\n2. [ ] c\n3. [x] a',
    );
  });
});

describe('sortToggledTask — unchecking floats above the checked run', () => {
  it('moves a just-unchecked item above checked siblings', () => {
    expect(toggleAndSort('- [ ] a\n- [x] b\n- [x] c', 3)).toBe('- [ ] a\n- [ ] c\n- [x] b');
  });

  it('is a no-op when nothing below it is checked', () => {
    const toggled = toggleTaskAtLine('- [ ] a\n- [x] b', 2)!;
    expect(sortToggledTask(toggled, 2)).toBeNull();
  });

  it('lands at the end of the unchecked run, not the very top', () => {
    expect(toggleAndSort('- [ ] a\n- [ ] b\n- [x] c\n- [x] d', 4)).toBe(
      '- [ ] a\n- [ ] b\n- [ ] d\n- [x] c',
    );
  });
});

describe('sortToggledTask — group boundaries and formatting preservation (review regressions)', () => {
  it('does not walk up across a thematic break into a previous list', () => {
    // "* * *" matches the list-marker regex; unchecking `a` must not teleport
    // it into the list above the break.
    const src = '- [x] x\n- [ ] y\n\n* * *\n\n- [x] a\n- [ ] b';
    const toggled = toggleTaskAtLine(src, 6)!;
    expect(sortToggledTask(toggled, 6)).toBeNull(); // nothing checked below it
  });

  it('treats "- - -" as a break, not a sibling, scanning down', () => {
    const src = '- [ ] a\n- [ ] b\n- - -\n- [ ] c';
    expect(toggleAndSort(src, 1)).toBe('- [ ] b\n- [x] a\n- - -\n- [ ] c');
  });

  it('keeps tight neighbors tight in a partially loose group', () => {
    const src = '- [ ] a\n\n- [ ] b\n- [ ] c';
    expect(toggleAndSort(src, 1)).toBe('- [ ] b\n- [ ] c\n\n- [x] a');
  });

  it('is a no-op when checking the last item of a partially loose group', () => {
    const src = '- [ ] a\n\n- [ ] b\n- [ ] c';
    const toggled = toggleTaskAtLine(src, 4)!;
    expect(sortToggledTask(toggled, 4)).toBeNull(); // must NOT rewrite spacing
  });

  it('is a no-op when an item has a blank-separated continuation and the last item is checked', () => {
    const src = '- [ ] u1\n- [ ] u2\n\n    continuation\n\n- [ ] a\n- [ ] b';
    const toggled = toggleTaskAtLine(src, 7)!;
    expect(sortToggledTask(toggled, 7)).toBeNull();
  });

  it('keeps a lazy continuation line attached to ITS item', () => {
    const src = '- [ ] b\n- [ ] a\nlazy continuation of a\n- [ ] c';
    expect(toggleAndSort(src, 1)).toBe(
      '- [ ] a\nlazy continuation of a\n- [ ] c\n- [x] b',
    );
  });

  it('preserves the start ordinal when renumbering', () => {
    expect(toggleAndSort('3. [ ] a\n4. [ ] b', 1)).toBe('3. [ ] b\n4. [x] a');
  });

  it('does not treat a heading jammed under an item as its lazy continuation', () => {
    const src = '- [ ] a\n# heading\n\n- [ ] unrelated';
    const toggled = toggleTaskAtLine(src, 1)!;
    // `a` is a single-item group (the heading ends it) — nothing to sort.
    expect(sortToggledTask(toggled, 1)).toBeNull();
  });

  it('does not treat a raw HTML line as a lazy continuation', () => {
    // The <div> starts an HTML block (which swallows the next line up to a
    // blank), so `a` is a single-item list — nothing may move.
    const src = '- [ ] a\n<div>x</div>\n- [ ] b';
    const toggled = toggleTaskAtLine(src, 1)!;
    expect(sortToggledTask(toggled, 1)).toBeNull();
  });

  it('does not renumber non-contiguous ordinals on a no-op toggle', () => {
    const src = '1. [ ] a\n3. [ ] b\n7. [ ] c';
    const toggled = toggleTaskAtLine(src, 3)!; // check `c` — already last
    expect(sortToggledTask(toggled, 3)).toBeNull();
  });
});

describe('sortToggledTask — guards', () => {
  it('returns null for a non-task line', () => {
    expect(sortToggledTask('- plain\n- [ ] a', 1)).toBeNull();
  });

  it('returns null for out-of-range lines', () => {
    expect(sortToggledTask('- [x] a', 0)).toBeNull();
    expect(sortToggledTask('- [x] a', 5)).toBeNull();
  });

  it('does not treat a checkbox-link "- [x](url)" as a task', () => {
    expect(sortToggledTask('- [x](url)\n- [ ] real', 1)).toBeNull();
  });

  it('leaves frontmatter and preceding content untouched', () => {
    const src = '---\ntags: [x]\n---\n\n- [ ] a\n- [ ] b';
    expect(toggleAndSort(src, 5)).toBe('---\ntags: [x]\n---\n\n- [ ] b\n- [x] a');
  });
});
