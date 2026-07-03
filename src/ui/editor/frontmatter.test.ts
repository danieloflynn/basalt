import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { describe, expect, it } from 'vitest';
import { frontmatter } from './frontmatter';

/**
 * Drives the ACTUAL markdown parser the editor uses (GFM + the frontmatter
 * block extension). Regression coverage for the parse-tree destruction on
 * unclosed fences, plus the `---`-only close semantics that must match
 * src/lib/frontmatter.ts.
 */
const parser = markdown({ base: markdownLanguage, extensions: [frontmatter] }).language.parser;

/** Flat list of node names in document order. */
function nodeNames(src: string): string[] {
  const out: string[] = [];
  parser.parse(src).cursor().iterate((n) => {
    out.push(n.name);
  });
  return out;
}

describe('frontmatter block parser', () => {
  it('an UNCLOSED --- never eats the rest of the document', () => {
    // The core defect: nextLine() never rewinds, so a consuming-then-bailing
    // parser collapsed everything into one empty paragraph.
    const names = nodeNames('---\n# H\n- li');
    expect(names).toContain('ATXHeading1');
    expect(names).toContain('ListItem');
    expect(names).not.toContain('Frontmatter');
  });

  it('a lone --- is a HorizontalRule, not a swallowed frontmatter', () => {
    const names = nodeNames('---');
    expect(names).toContain('HorizontalRule');
    expect(names).not.toContain('Frontmatter');
  });

  it('valid frontmatter parses as a Frontmatter node with no setext heading', () => {
    const names = nodeNames('---\ntitle: x\ntags: [a]\n---\n# Body');
    expect(names).toContain('Frontmatter');
    expect(names).not.toContain('SetextHeading1');
    expect(names).not.toContain('SetextHeading2');
    // The body after the closing fence still parses normally.
    expect(names).toContain('ATXHeading1');
  });

  it('a mid-document --- is untouched by the frontmatter parser', () => {
    const names = nodeNames('# Top\n\n---\n\ntext');
    expect(names).toContain('ATXHeading1');
    expect(names).toContain('HorizontalRule');
    expect(names).not.toContain('Frontmatter');
  });

  it('---- (four dashes) on the first line is NOT frontmatter', () => {
    const names = nodeNames('----\n# H\n---');
    expect(names).not.toContain('Frontmatter');
    expect(names).toContain('ATXHeading1');
  });

  it('a blank first line then --- is not frontmatter', () => {
    const names = nodeNames('\n---\n# H');
    expect(names).not.toContain('Frontmatter');
    expect(names).toContain('ATXHeading1');
  });

  it('close fence must be exactly --- (---- does not close a block)', () => {
    // No valid closing ---, so the leading --- must not swallow the heading.
    const names = nodeNames('---\ntitle: x\n----\n# H');
    expect(names).not.toContain('Frontmatter');
    expect(names).toContain('ATXHeading1');
  });

  it('two adjacent fences (---\\n---) are not frontmatter (mirrors src/lib)', () => {
    // src/lib/frontmatter requires at least one content line between fences.
    const names = nodeNames('---\n---\nbody');
    expect(names).not.toContain('Frontmatter');
  });
});
