import { describe, expect, it } from 'vitest';
import { diffLines } from './diff';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter';
import { extractBlock, extractOutline, removeComments, slugifyHeading } from './outline';
import { extractTags } from './tags';
import { buildTree, walkFiles } from './tree';
import { dirname, extname, isHiddenPath, joinPath, normalizePath, noteTitle } from './paths';
import { LinkResolver, parseWikilinks, wikilinkDisplayText } from './wikilinks';
import { stripInlineMarkdown } from './plaintext';
import { claimAxis, drawerProgress, FLING_VELOCITY, pullTriggered, settleOpen, velocityX } from './gesture';

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

describe('outline utilities', () => {
  it('extracts headings with levels, lines, slugs (skipping code)', () => {
    const src = '# One\n\ntext\n\n```\n# not a heading\n```\n\n## Two Words!\n';
    const outline = extractOutline(src);
    expect(outline).toHaveLength(2);
    expect(outline[0]).toMatchObject({ level: 1, text: 'One', line: 1, slug: 'one' });
    expect(outline[1]).toMatchObject({ level: 2, text: 'Two Words!', slug: 'two-words' });
    expect(slugifyHeading('Héllo & World')).toBe('héllo-world');
  });

  it('removes comments but keeps line count stable', () => {
    const src = 'a %%gone%% b\nline2 %%multi\nline%% end\n`%%code%%` stays';
    const out = removeComments(src);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out).not.toContain('gone');
    expect(out).not.toContain('multi');
    expect(out).toContain('`%%code%%` stays');
  });

  it('extracts a tagged block and strips the marker', () => {
    const src = 'intro\n\nThe important paragraph\nspanning two lines ^blk1\n\nafter';
    expect(extractBlock(src, 'blk1')).toBe('The important paragraph\nspanning two lines');
    expect(extractBlock(src, 'nope')).toBeNull();
  });
});

describe('diffLines', () => {
  it('marks added, removed, and unchanged lines', () => {
    const diff = diffLines('a\nb\nc', 'a\nx\nc\nd');
    expect(diff).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'x' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
  });

  it('handles identical inputs', () => {
    expect(diffLines('a\nb', 'a\nb').every((l) => l.kind === 'same')).toBe(true);
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

describe('stripInlineMarkdown', () => {
  it('keeps words, drops syntax', () => {
    const md = '# Basalt\nA **beautiful** *vault* with `code` and ==marks==.';
    expect(stripInlineMarkdown(md)).toBe('Basalt A beautiful vault with code and marks.');
  });

  it('resolves links to their labels', () => {
    expect(stripInlineMarkdown('See [[Projects/Basalt|the app]] and [[Welcome]].')).toBe(
      'See the app and Welcome.',
    );
    expect(stripInlineMarkdown('Embed ![[Projects/Basalt#Why]] here')).toBe(
      'Embed Basalt#Why here',
    );
    expect(stripInlineMarkdown('[docs](https://example.com) and ![alt](img.png)')).toBe(
      'docs and alt',
    );
  });

  it('drops comments, block ids, list and quote markers', () => {
    const md = '> quoted\n- [ ] task %%secret%%\n1. first ^block-id\n---';
    const out = stripInlineMarkdown(md);
    expect(out).toContain('quoted');
    expect(out).toContain('task');
    expect(out).toContain('first');
    expect(out).not.toContain('secret');
    expect(out).not.toContain('^block-id');
    expect(out).not.toContain('- [ ]');
  });
});

describe('gesture math', () => {
  it('claims an axis only past the slop, with horizontal bias', () => {
    expect(claimAxis(5, 5)).toBeNull();
    expect(claimAxis(20, 5)).toBe('x');
    expect(claimAxis(14, 12)).toBeNull(); // ambiguous diagonal stays undecided
    expect(claimAxis(5, 20)).toBe('y');
    expect(claimAxis(-20, 4)).toBe('x'); // sign-agnostic
  });

  it('maps finger travel to drawer progress from either anchor', () => {
    expect(drawerProgress(false, 0, 320)).toBe(0);
    expect(drawerProgress(false, 160, 320)).toBe(0.5);
    expect(drawerProgress(false, 999, 320)).toBe(1);
    expect(drawerProgress(true, -160, 320)).toBe(0.5);
    expect(drawerProgress(true, 80, 320)).toBe(1); // can't over-open
  });

  it('settles on position unless a fling decides it', () => {
    expect(settleOpen(0.6, 0)).toBe(true);
    expect(settleOpen(0.4, 0)).toBe(false);
    expect(settleOpen(0.2, 0.5)).toBe(true); // fling right
    expect(settleOpen(0.9, -0.5)).toBe(false); // fling left
  });

  it('measures velocity over the trailing window', () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 50, x: 10, y: 0 },
      { t: 100, x: 40, y: 0 },
    ];
    expect(velocityX(samples)).toBeCloseTo(0.4);
    expect(velocityX([{ t: 0, x: 0, y: 0 }])).toBe(0);
  });

  it('drops stale flick velocity after a motionless hold before release', () => {
    // A fast leftward drag, then the finger holds still for ~2s before lifting.
    const fast = [
      { t: 0, x: 200, y: 0 },
      { t: 40, x: 120, y: 0 },
      { t: 80, x: 20, y: 0 }, // ~2.25 px/ms up to here
    ];
    // Released promptly (10ms after the last sample): a genuine fling stands.
    expect(velocityX(fast, 90)).toBeLessThanOrEqual(-FLING_VELOCITY);
    // Released 2s after the last movement sample: no flick — velocity is 0.
    expect(velocityX(fast, 2080)).toBe(0);
    // With velocity gone, the position rule alone decides where it settles.
    expect(settleOpen(0.7, velocityX(fast, 2080))).toBe(true);
    expect(settleOpen(0.3, velocityX(fast, 2080))).toBe(false);
  });

  it('still flings when the finger lifts right after moving', () => {
    const flick = [
      { t: 0, x: 0, y: 0 },
      { t: 40, x: 90, y: 0 },
      { t: 80, x: 200, y: 0 },
    ];
    const v = velocityX(flick, 92); // released 12ms after the last sample
    expect(v).toBeGreaterThanOrEqual(FLING_VELOCITY);
    expect(settleOpen(0.1, v)).toBe(true); // fling wins over the closed position
  });

  it('triggers pull-down only for a firmly vertical drag', () => {
    expect(pullTriggered(0, 100)).toBe(true);
    expect(pullTriggered(0, 60)).toBe(false);
    expect(pullTriggered(120, 100)).toBe(false); // diagonal → drawer's business
  });
});
