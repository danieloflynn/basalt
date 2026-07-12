import { describe, expect, it } from 'vitest';
import { stripCode } from './tags';

/** stripCode masks code to spaces; a masked region contains no live markers. */
const hides = (out: string, needle: string) => !out.includes(needle);
const keeps = (out: string, needle: string) => out.includes(needle);

describe('stripCode', () => {
  it('preserves length and offsets exactly (same-length filler)', () => {
    const src = 'a `b` c\n```\nx\n```\n[[y]] tail';
    const out = stripCode(src);
    expect(out.length).toBe(src.length);
    // outside code, the masked text is byte-identical to the original
    expect(out.slice(-10)).toBe('[[y]] tail');
  });

  it('(a) masks an unclosed fence all the way to EOF', () => {
    const src = 'live [[A]]\n```\nfenced [[B]] to eof';
    const out = stripCode(src);
    expect(keeps(out, 'live [[A]]')).toBe(true);
    expect(hides(out, '[[B]]')).toBe(true);
  });

  it('(b) masks a 4+-backtick fence that contains ``` lines', () => {
    const src = '````\n```\n[[X]]\n````\n[[Y]]';
    const out = stripCode(src);
    expect(hides(out, '[[X]]')).toBe(true);
    expect(keeps(out, '[[Y]]')).toBe(true);
  });

  it('(c) masks double-backtick inline code', () => {
    const src = 'text ``[[X]]`` then [[Y]]';
    const out = stripCode(src);
    expect(hides(out, '[[X]]')).toBe(true);
    expect(keeps(out, '[[Y]]')).toBe(true);
  });

  it('(d) masks a fence indented 1–3 spaces', () => {
    const src = '  ```\n[[X]]\n  ```\n[[Y]]';
    const out = stripCode(src);
    expect(hides(out, '[[X]]')).toBe(true);
    expect(keeps(out, '[[Y]]')).toBe(true);
  });

  it('(e) masks a fence inside a blockquote', () => {
    const src = '> ```\n> [[X]]\n> ```\n[[Y]]';
    const out = stripCode(src);
    expect(hides(out, '[[X]]')).toBe(true);
    expect(keeps(out, '[[Y]]')).toBe(true);
  });

  it('masks ~~~ fences', () => {
    const src = '~~~\n[[X]]\n~~~\n[[Y]]';
    const out = stripCode(src);
    expect(hides(out, '[[X]]')).toBe(true);
    expect(keeps(out, '[[Y]]')).toBe(true);
  });

  it('masks single- and double-backtick inline spans, pairing equal runs', () => {
    const src = '`[[a]]` and ``[[b]]`` and [[c]]';
    const out = stripCode(src);
    expect(hides(out, '[[a]]')).toBe(true);
    expect(hides(out, '[[b]]')).toBe(true);
    expect(keeps(out, '[[c]]')).toBe(true);
  });

  it('leaves a properly closed column-0 fence content masked and outside kept', () => {
    const src = 'before [[A]]\n```\ncode [[A]]\n```\nafter [[A]]';
    const out = stripCode(src);
    const lines = out.split('\n');
    expect(lines[0]).toBe('before [[A]]');
    expect(lines[2].trim()).toBe('');
    expect(lines[4]).toBe('after [[A]]');
  });

  it('does not treat a run of < 3 backticks at line start as a fence', () => {
    const src = '``not a fence`` [[A]]';
    const out = stripCode(src);
    // the inline `` `` pair is masked, the live link survives
    expect(keeps(out, '[[A]]')).toBe(true);
  });
});
