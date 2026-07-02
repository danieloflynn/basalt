import { describe, expect, it } from 'vitest';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter';
import { extractTags } from './tags';
import { buildTree, walkFiles } from './tree';
import { dirname, extname, isHiddenPath, joinPath, normalizePath, noteTitle } from './paths';
import { LinkResolver, parseWikilinks, wikilinkDisplayText } from './wikilinks';

describe('paths', () => {
  it('normalizes separators and dots', () => {
    expect(normalizePath('./a/b//c/')).toBe('a/b/c');
    expect(normalizePath('a/../b')).toBe('b');
    expect(joinPath('notes', 'daily/', '2026.md')).toBe('notes/daily/2026.md');
  });

  it('splits names and extensions', () => {
    expect(dirname('a/b/c.md')).toBe('a/b');
    expect(dirname('c.md')).toBe('');
    expect(extname('a/B.PNG')).toBe('.png');
    expect(extname('.gitignore')).toBe('');
    expect(noteTitle('notes/My Note.md')).toBe('My Note');
  });

  it('detects hidden paths at any depth', () => {
    expect(isHiddenPath('.obsidian/app.json')).toBe(true);
    expect(isHiddenPath('notes/.trash/x.md')).toBe(true);
    expect(isHiddenPath('notes/x.md')).toBe(false);
  });
});

describe('frontmatter', () => {
  it('parses a simple block', () => {
    const fm = parseFrontmatter('---\ntitle: Hello\ntags: [a, b]\n---\nBody');
    expect(fm.data.title).toBe('Hello');
    expect(fm.body).toBe('Body');
    expect(fm.raw).toContain('title: Hello');
  });

  it('handles CRLF, absence, and invalid YAML', () => {
    expect(parseFrontmatter('---\r\na: 1\r\n---\r\nBody').data.a).toBe(1);
    expect(parseFrontmatter('no frontmatter').raw).toBeNull();
    const invalid = parseFrontmatter('---\n: : :\n---\nBody');
    expect(invalid.data).toEqual({});
    expect(invalid.body).toBe('---\n: : :\n---\nBody');
  });

  it('round-trips through serialize', () => {
    const out = serializeFrontmatter({ title: 'X' }, 'Body\n');
    expect(parseFrontmatter(out)).toMatchObject({ data: { title: 'X' }, body: 'Body\n' });
    expect(serializeFrontmatter({}, 'Body')).toBe('Body');
  });
});

describe('parseWikilinks', () => {
  it('parses targets, aliases, headings, blocks, embeds', () => {
    const links = parseWikilinks('See [[Note]] and [[a/B|alias]] and [[C#Head]] and [[D#^blk]] and ![[img.png]]');
    expect(links).toHaveLength(5);
    expect(links[0]).toMatchObject({ target: 'Note', embed: false });
    expect(links[1]).toMatchObject({ target: 'a/B', alias: 'alias' });
    expect(links[2]).toMatchObject({ target: 'C', heading: 'Head' });
    expect(links[3]).toMatchObject({ target: 'D', blockRef: 'blk' });
    expect(links[4]).toMatchObject({ target: 'img.png', embed: true });
  });

  it('records positions and display text', () => {
    const [link] = parseWikilinks('xx [[A|Nice]]');
    expect(link.start).toBe(3);
    expect(link.end).toBe(13);
    expect(wikilinkDisplayText(link)).toBe('Nice');
    expect(wikilinkDisplayText({ target: 'a/Deep Note.md' })).toBe('Deep Note');
    expect(wikilinkDisplayText({ target: 'A', heading: 'H' })).toBe('A > H');
  });
});

describe('LinkResolver', () => {
  const resolver = new LinkResolver([
    'Inbox.md',
    'projects/Basalt.md',
    'projects/notes/Design.md',
    'archive/Design.md',
    'assets/img.png',
  ]);

  it('resolves bare names and exact paths', () => {
    expect(resolver.resolve('Inbox', 'projects/Basalt.md')).toBe('Inbox.md');
    expect(resolver.resolve('projects/Basalt', 'Inbox.md')).toBe('projects/Basalt.md');
    expect(resolver.resolve('projects/Basalt.md', 'Inbox.md')).toBe('projects/Basalt.md');
    expect(resolver.resolve('inbox', 'Inbox.md')).toBe('Inbox.md');
  });

  it('resolves ambiguous bare names to the closest file', () => {
    expect(resolver.resolve('Design', 'projects/Basalt.md')).toBe('projects/notes/Design.md');
    expect(resolver.resolve('Design', 'archive/Old.md')).toBe('archive/Design.md');
  });

  it('resolves attachments and relative paths, misses unknowns', () => {
    expect(resolver.resolve('img.png', 'Inbox.md')).toBe('assets/img.png');
    expect(resolver.resolve('notes/Design', 'projects/Basalt.md')).toBe('projects/notes/Design.md');
    expect(resolver.resolve('Nope', 'Inbox.md')).toBeNull();
  });

  it('tracks additions and removals', () => {
    const r = new LinkResolver(['A.md']);
    r.add('B.md');
    expect(r.resolve('B', 'A.md')).toBe('B.md');
    r.remove('B.md');
    expect(r.resolve('B', 'A.md')).toBeNull();
  });
});

describe('extractTags', () => {
  it('merges frontmatter and inline tags, skipping code', () => {
    const src = [
      '---',
      'tags: [alpha, beta]',
      '---',
      'Inline #gamma and #alpha again, nested #proj/sub.',
      '`#not-a-tag` and:',
      '```',
      '#also-not',
      '```',
      'not#this either, nor #123 pure numbers',
    ].join('\n');
    expect(extractTags(src).sort()).toEqual(['alpha', 'beta', 'gamma', 'proj/sub'].sort());
  });
});

describe('buildTree', () => {
  it('builds sorted tree, folders first, hidden paths excluded', () => {
    const tree = buildTree(['b.md', 'A.md', 'notes/z.md', 'notes/a.md', '.obsidian/x.json', 'assets/i.png']);
    expect(tree.children.map((c) => c.name)).toEqual(['assets', 'notes', 'A.md', 'b.md']);
    const notes = tree.children.find((c) => c.name === 'notes');
    expect(notes?.kind).toBe('folder');
    expect([...walkFiles(tree)].map((f) => f.path)).toContain('notes/a.md');
    expect([...walkFiles(tree)].map((f) => f.path)).not.toContain('.obsidian/x.json');
  });

  it('surfaces folders whose only content is hidden (.gitkeep)', () => {
    const tree = buildTree(['drafts/.gitkeep', 'a.md', '.obsidian/app.json', 'x/.trash/gone.md']);
    expect(tree.children.map((c) => c.name)).toEqual(['drafts', 'a.md']);
    const drafts = tree.children.find((c) => c.name === 'drafts');
    expect(drafts?.kind === 'folder' && drafts.children.length).toBe(0);
  });
});
