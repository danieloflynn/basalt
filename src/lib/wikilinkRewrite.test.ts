import { describe, expect, it } from 'vitest';
import { rewriteWikilinks, rewriteMarkdownLinks } from './wikilinkRewrite';

/** Rewrite links whose written target (case-insensitively) matches `oldName`. */
const to = (newBase: string, oldName: string) => (text: string) =>
  rewriteWikilinks(text, {
    newBase,
    shouldRewrite: (t) => t.toLowerCase() === oldName.toLowerCase(),
  });

describe('rewriteWikilinks', () => {
  const rename = to('New', 'Old');

  it('rewrites a bare link', () => {
    expect(rename('see [[Old]] here')).toBe('see [[New]] here');
  });

  it('rewrites an embed, preserving the ! prefix', () => {
    expect(rename('![[Old]]')).toBe('![[New]]');
  });

  it('preserves #heading, #^block, and |alias suffixes', () => {
    expect(rename('[[Old#Intro]]')).toBe('[[New#Intro]]');
    expect(rename('[[Old#^abc123]]')).toBe('[[New#^abc123]]');
    expect(rename('[[Old|the alias]]')).toBe('[[New|the alias]]');
    expect(rename('[[Old#Intro|see intro]]')).toBe('[[New#Intro|see intro]]');
  });

  it('preserves a folder qualifier, swapping only the basename', () => {
    expect(rewriteWikilinks('[[Notes/Old]]', {
      newBase: 'New',
      shouldRewrite: (t) => t === 'Notes/Old',
    })).toBe('[[Notes/New]]');
  });

  it('preserves a written .md extension', () => {
    expect(rewriteWikilinks('[[Old.md]]', {
      newBase: 'New',
      shouldRewrite: (t) => t === 'Old.md',
    })).toBe('[[New.md]]');
  });

  it('rewrites regardless of the link target casing', () => {
    expect(rename('[[old]] and [[OLD#H]]')).toBe('[[New]] and [[New#H]]');
  });

  it('leaves fenced code blocks untouched', () => {
    const src = 'before [[Old]]\n```\ncode [[Old]] stays\n```\nafter [[Old]]';
    expect(rename(src)).toBe('before [[New]]\n```\ncode [[Old]] stays\n```\nafter [[New]]');
  });

  it('leaves inline code untouched', () => {
    expect(rename('real [[Old]] but `[[Old]]` is code')).toBe(
      'real [[New]] but `[[Old]]` is code',
    );
  });

  it('leaves non-matching links alone (respects the resolver decision)', () => {
    expect(rename('[[Other]] and [[Old]]')).toBe('[[Other]] and [[New]]');
  });

  it('does not touch empty self-heading targets', () => {
    expect(rename('[[#Section]]')).toBe('[[#Section]]');
  });

  it('is a no-op when nothing matches', () => {
    const src = 'plain text, no links, [[Different]]';
    expect(rename(src)).toBe(src);
  });

  it('rewrites multiple occurrences on one line', () => {
    expect(rename('[[Old]] then [[Old|x]] then [[Old#h]]')).toBe(
      '[[New]] then [[New|x]] then [[New#h]]',
    );
  });

  it('handles names containing spaces', () => {
    expect(rewriteWikilinks('link to [[My Note]] here', {
      newBase: 'Renamed Note',
      shouldRewrite: (t) => t === 'My Note',
    })).toBe('link to [[Renamed Note]] here');
  });
});

describe('rewriteWikilinks with newDir (moves)', () => {
  /** Move Notes/Old.md → Archive/Old.md: only folder-qualified links break. */
  const move = (text: string) =>
    rewriteWikilinks(text, {
      newBase: 'Old',
      newDir: 'Archive',
      // Stand-in for the resolver: qualified targets that hit the moved note.
      shouldRewrite: (t) =>
        t.includes('/') && t.toLowerCase().replace(/\.md$/, '').endsWith('/old'),
    });

  it('replaces the folder qualifier with the new folder', () => {
    expect(move('see [[Notes/Old]] here')).toBe('see [[Archive/Old]] here');
  });

  it('collapses a nested qualifier to the new vault-absolute folder', () => {
    expect(move('[[Deep/Nested/Old]]')).toBe('[[Archive/Old]]');
  });

  it('strips the qualifier on a move to the vault root', () => {
    expect(
      rewriteWikilinks('[[Notes/Old]]', {
        newBase: 'Old',
        newDir: '',
        shouldRewrite: (t) => t === 'Notes/Old',
      }),
    ).toBe('[[Old]]');
  });

  it('preserves .md, #heading, |alias and the embed prefix', () => {
    expect(move('![[Notes/Old.md]]')).toBe('![[Archive/Old.md]]');
    expect(move('[[Notes/Old#Intro|see]]')).toBe('[[Archive/Old#Intro|see]]');
  });

  it('leaves bare links alone when the caller only accepts qualified ones', () => {
    expect(move('[[Old]] and [[Notes/Old]]')).toBe('[[Old]] and [[Archive/Old]]');
  });

  it('qualifies a bare link when the caller accepts it (dedupe changed the basename)', () => {
    expect(
      rewriteWikilinks('[[Old]]', {
        newBase: 'Old 2',
        newDir: 'Archive',
        shouldRewrite: (t) => t === 'Old',
      }),
    ).toBe('[[Archive/Old 2]]');
  });

  it('still skips code with newDir set', () => {
    expect(move('`[[Notes/Old]]` and [[Notes/Old]]')).toBe(
      '`[[Notes/Old]]` and [[Archive/Old]]',
    );
  });
});

describe('rewriteWikilinks edge inputs', () => {
  const rename = to('New', 'Old');

  it('trims surrounding whitespace inside the brackets', () => {
    expect(rename('[[ Old ]]')).toBe('[[New]]');
  });

  it('leaves an escaped-pipe target untouched (no corruption)', () => {
    // `\|` is not the alias separator, so the target becomes `Old\|alias`, which
    // does not equal `Old`; the conservative parser skips it rather than
    // dropping the backslash and corrupting a table cell.
    expect(rename('[[Old\\|alias]]')).toBe('[[Old\\|alias]]');
  });

  it('rewrites a genuine (unescaped) alias', () => {
    expect(rename('[[Old|alias]]')).toBe('[[New|alias]]');
  });

  it('leaves ~~~ fenced blocks untouched', () => {
    const src = '[[Old]]\n~~~\n[[Old]]\n~~~\n[[Old]]';
    expect(rename(src)).toBe('[[New]]\n~~~\n[[Old]]\n~~~\n[[New]]');
  });
});

describe('rewriteWikilinks qualifyBare (rename ambiguity)', () => {
  it('keeps a bare link bare when it still resolves right', () => {
    expect(
      rewriteWikilinks('[[Old]]', {
        newBase: 'New',
        shouldRewrite: (t) => t === 'Old',
        qualifyBare: () => null,
      }),
    ).toBe('[[New]]');
  });

  it('qualifies a bare link with a folder when bare would mis-resolve', () => {
    expect(
      rewriteWikilinks('[[Old]]', {
        newBase: 'New',
        shouldRewrite: (t) => t === 'Old',
        qualifyBare: () => 'A',
      }),
    ).toBe('[[A/New]]');
  });

  it('never consults qualifyBare for an already-qualified link', () => {
    expect(
      rewriteWikilinks('[[Sub/Old]]', {
        newBase: 'New',
        shouldRewrite: (t) => t === 'Sub/Old',
        qualifyBare: () => 'SHOULD-NOT-APPEAR',
      }),
    ).toBe('[[Sub/New]]');
  });

  it('applies qualifyBare to a #^block + alias link, keeping the suffixes', () => {
    expect(
      rewriteWikilinks('[[Old#^blk|see]]', {
        newBase: 'New',
        shouldRewrite: (t) => t === 'Old',
        qualifyBare: () => 'A',
      }),
    ).toBe('[[A/New#^blk|see]]');
  });
});

describe('rewriteMarkdownLinks', () => {
  it('rewrites a percent-encoded target, preserving %20 encoding', () => {
    expect(
      rewriteMarkdownLinks('see [text](Old%20Note.md) here', {
        newName: 'New Note.md',
        shouldRewrite: (dp) => dp === 'Old Note.md',
      }),
    ).toBe('see [text](New%20Note.md) here');
  });

  it('rewrites a literal (unencoded) target, staying literal', () => {
    expect(
      rewriteMarkdownLinks('[x](OldNote.md)', {
        newName: 'NewNote.md',
        shouldRewrite: (dp) => dp === 'OldNote.md',
      }),
    ).toBe('[x](NewNote.md)');
  });

  it('rewrites an image embed, preserving ! and alt text, swapping the folder', () => {
    expect(
      rewriteMarkdownLinks('![alt](A/img.png)', {
        newName: 'img.png',
        newDir: 'B',
        shouldRewrite: (dp) => dp === 'A/img.png',
      }),
    ).toBe('![alt](B/img.png)');
  });

  it('preserves a #fragment', () => {
    expect(
      rewriteMarkdownLinks('[t](Old.md#Intro)', {
        newName: 'New.md',
        shouldRewrite: (dp) => dp === 'Old.md',
      }),
    ).toBe('[t](New.md#Intro)');
  });

  it('resolves a leading ./ and keeps it on a rename in place', () => {
    expect(
      rewriteMarkdownLinks('[t](./Old.md)', {
        newName: 'New.md',
        shouldRewrite: (dp) => dp === 'Old.md',
      }),
    ).toBe('[t](./New.md)');
  });

  it('skips absolute URLs and in-page anchors', () => {
    const src = '[a](https://x.com/Old.md) and [b](#Old.md)';
    expect(rewriteMarkdownLinks(src, { newName: 'New.md', shouldRewrite: () => true })).toBe(src);
  });

  it('skips links inside code but rewrites the live one', () => {
    expect(
      rewriteMarkdownLinks('`[t](Old.md)` and [t](Old.md)', {
        newName: 'New.md',
        shouldRewrite: (dp) => dp === 'Old.md',
      }),
    ).toBe('`[t](Old.md)` and [t](New.md)');
  });

  it('preserves an inline-code span inside the link text', () => {
    expect(
      rewriteMarkdownLinks('[a `x` b](Old.md)', {
        newName: 'New.md',
        shouldRewrite: (dp) => dp === 'Old.md',
      }),
    ).toBe('[a `x` b](New.md)');
  });

  it('qualifies a bare markdown link when bare would mis-resolve', () => {
    expect(
      rewriteMarkdownLinks('[t](Old.md)', {
        newName: 'New.md',
        shouldRewrite: (dp) => dp === 'Old.md',
        qualifyBare: () => 'A',
      }),
    ).toBe('[t](A/New.md)');
  });
});
