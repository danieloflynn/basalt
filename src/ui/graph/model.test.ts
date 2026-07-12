import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPH_CONFIG, type GraphConfig } from './config';
import {
  buildGraphModel,
  matchesGroupQuery,
  timelapseOrder,
  timelapseSlice,
  type RawLink,
  type RawNote,
} from './model';

const notes: RawNote[] = [
  { path: 'A.md', title: 'A', tags: ['x'], mtimeMs: 100 },
  { path: 'B.md', title: 'B', tags: ['x/child'], mtimeMs: 200 },
  { path: 'C.md', title: 'C', tags: [], mtimeMs: 50 }, // orphan
];

const links: RawLink[] = [
  { from: 'A.md', target: 'B', resolved: 'B.md', resolvedIsMarkdown: true },
  { from: 'A.md', target: 'img.png', resolved: 'img.png', resolvedIsMarkdown: false },
  { from: 'B.md', target: 'Missing', resolved: null, resolvedIsMarkdown: false },
];

function cfg(patch: Partial<GraphConfig['filters']>, groups: GraphConfig['groups'] = []): GraphConfig {
  return {
    ...DEFAULT_GRAPH_CONFIG,
    filters: { ...DEFAULT_GRAPH_CONFIG.filters, ...patch },
    groups,
  };
}

describe('matchesGroupQuery', () => {
  it('matches tag: and tag:# forms', () => {
    expect(matchesGroupQuery('tag:x', { label: 'A', tags: ['x'] })).toBe(true);
    expect(matchesGroupQuery('tag:#x', { label: 'A', tags: ['x'] })).toBe(true);
    expect(matchesGroupQuery('tag:y', { label: 'A', tags: ['x'] })).toBe(false);
  });

  it('matches nested tags', () => {
    expect(matchesGroupQuery('tag:x', { label: 'B', tags: ['x/child'] })).toBe(true);
    expect(matchesGroupQuery('tag:xy', { label: 'B', tags: ['x/child'] })).toBe(false);
  });

  it('matches path: as a prefix (case-insensitive)', () => {
    expect(matchesGroupQuery('path:Projects', { label: 'x', path: 'Projects/Basalt.md' })).toBe(true);
    expect(matchesGroupQuery('path:Projects', { label: 'x', path: 'Archive/Old.md' })).toBe(false);
  });

  it('falls back to a title substring', () => {
    expect(matchesGroupQuery('wel', { label: 'Welcome' })).toBe(true);
    expect(matchesGroupQuery('ZZZ', { label: 'Welcome' })).toBe(false);
  });

  it('is false for a blank query', () => {
    expect(matchesGroupQuery('   ', { label: 'Welcome' })).toBe(false);
  });
});

describe('buildGraphModel filters', () => {
  it('defaults: only notes + note-note edges (baseline behaviour)', () => {
    const m = buildGraphModel(notes, links, DEFAULT_GRAPH_CONFIG);
    expect(m.nodes.map((n) => n.id).sort()).toEqual(['A.md', 'B.md', 'C.md']);
    expect(m.edges).toEqual([{ source: 'A.md', target: 'B.md' }]);
  });

  it('orphans off hides degree-0 notes', () => {
    const m = buildGraphModel(notes, links, cfg({ orphans: false }));
    expect(m.nodes.map((n) => n.id).sort()).toEqual(['A.md', 'B.md']);
  });

  it('tags on adds one node per tag, linked to its notes', () => {
    const m = buildGraphModel(notes, links, cfg({ tags: true }));
    const tagNodes = m.nodes.filter((n) => n.kind === 'tag');
    expect(tagNodes.map((n) => n.id).sort()).toEqual(['tag:x', 'tag:x/child']);
    expect(m.edges).toContainEqual({ source: 'A.md', target: 'tag:x' });
    expect(m.edges).toContainEqual({ source: 'B.md', target: 'tag:x/child' });
  });

  it('attachments on adds the embedded file', () => {
    const m = buildGraphModel(notes, links, cfg({ attachments: true }));
    const att = m.nodes.find((n) => n.kind === 'attachment');
    expect(att?.id).toBe('img.png');
    expect(m.edges).toContainEqual({ source: 'A.md', target: 'img.png' });
  });

  it('existingOnly off surfaces unresolved targets as phantoms', () => {
    const m = buildGraphModel(notes, links, cfg({ existingOnly: false }));
    const phantom = m.nodes.find((n) => n.kind === 'phantom');
    expect(phantom?.id).toBe('phantom:missing');
    expect(phantom?.label).toBe('Missing');
    expect(m.edges).toContainEqual({ source: 'B.md', target: 'phantom:missing' });
  });

  it('search filters notes by title/path substring', () => {
    const m = buildGraphModel(notes, links, cfg({ search: 'a' }));
    expect(m.nodes.map((n) => n.id)).toEqual(['A.md']);
    expect(m.edges).toEqual([]); // B filtered out
  });

  it('applies group colors, first matching group wins', () => {
    const m = buildGraphModel(
      notes,
      links,
      cfg({}, [
        { id: 'g1', query: 'path:A', color: '#111' },
        { id: 'g2', query: 'tag:x', color: '#222' },
      ]),
    );
    expect(m.nodes.find((n) => n.id === 'A.md')?.color).toBe('#111'); // g1 wins for A
    expect(m.nodes.find((n) => n.id === 'B.md')?.color).toBe('#222'); // only g2 matches B
    expect(m.nodes.find((n) => n.id === 'C.md')?.color).toBeUndefined();
  });
});

describe('artifacts as graph nodes', () => {
  // N (note) → art.html (artifact) and N → M (note); art.html → M (note);
  // art.html → deck.html (artifact). Artifact links resolve to non-markdown
  // graph nodes, so the model must gate edges on membership, not markdown-ness.
  const aNotes: RawNote[] = [
    { path: 'N.md', title: 'N', tags: [], mtimeMs: 100 },
    { path: 'M.md', title: 'M', tags: [], mtimeMs: 200 },
    { path: 'art.html', title: 'art', tags: [], mtimeMs: 150, isArtifact: true },
    { path: 'deck.html', title: 'deck', tags: [], mtimeMs: 300, isArtifact: true },
  ];
  const aLinks: RawLink[] = [
    { from: 'N.md', target: 'art.html', resolved: 'art.html', resolvedIsMarkdown: false },
    { from: 'N.md', target: 'M', resolved: 'M.md', resolvedIsMarkdown: true },
    { from: 'art.html', target: 'M', resolved: 'M.md', resolvedIsMarkdown: true },
    { from: 'art.html', target: 'deck.html', resolved: 'deck.html', resolvedIsMarkdown: false },
  ];

  it('renders artifacts as their own node kind', () => {
    const m = buildGraphModel(aNotes, aLinks, DEFAULT_GRAPH_CONFIG);
    expect(m.nodes.find((n) => n.id === 'art.html')?.kind).toBe('artifact');
    expect(m.nodes.find((n) => n.id === 'deck.html')?.kind).toBe('artifact');
    expect(m.nodes.find((n) => n.id === 'N.md')?.kind).toBe('note');
  });

  it('forms note→artifact, artifact→note and artifact→artifact edges', () => {
    const m = buildGraphModel(aNotes, aLinks, DEFAULT_GRAPH_CONFIG);
    expect(m.edges).toContainEqual({ source: 'N.md', target: 'art.html' });
    expect(m.edges).toContainEqual({ source: 'art.html', target: 'M.md' });
    expect(m.edges).toContainEqual({ source: 'art.html', target: 'deck.html' });
  });

  it('never double-counts an artifact as an attachment', () => {
    const withImg: RawLink[] = [
      ...aLinks,
      { from: 'N.md', target: 'pic.png', resolved: 'pic.png', resolvedIsMarkdown: false },
    ];
    const m = buildGraphModel(aNotes, withImg, cfg({ attachments: true }));
    const attachments = m.nodes.filter((n) => n.kind === 'attachment').map((n) => n.id);
    expect(attachments).toEqual(['pic.png']); // only the real attachment, not the .html files
  });

  it('includes artifacts in the timelapse reveal order (by mtime)', () => {
    const m = buildGraphModel(aNotes, aLinks, DEFAULT_GRAPH_CONFIG);
    expect(timelapseOrder(m.nodes)).toEqual(['N.md', 'art.html', 'M.md', 'deck.html']);
  });
});

describe('edge dedup keys', () => {
  // Vault paths legally contain spaces (and, via titles like "A.md B", an inner
  // ".md"): `sanitizeNoteTitle` only strips a TRAILING .md. A space-joined dedup
  // key would collapse two distinct edges into one; the newline-joined key must
  // not. Both pairs below share the space-join "A.md B.md C.md".
  const collideNotes: RawNote[] = [
    { path: 'A.md', title: 'A', tags: [], mtimeMs: 1 },
    { path: 'A.md B.md', title: 'A.md B', tags: [], mtimeMs: 2 },
    { path: 'B.md C.md', title: 'B.md C', tags: [], mtimeMs: 3 },
    { path: 'C.md', title: 'C', tags: [], mtimeMs: 4 },
  ];
  const collideLinks: RawLink[] = [
    { from: 'A.md', target: 'B.md C', resolved: 'B.md C.md', resolvedIsMarkdown: true },
    { from: 'A.md B.md', target: 'C', resolved: 'C.md', resolvedIsMarkdown: true },
  ];

  it('keeps both edges whose space-joined keys would collide', () => {
    const m = buildGraphModel(collideNotes, collideLinks, DEFAULT_GRAPH_CONFIG);
    expect(m.edges).toContainEqual({ source: 'A.md', target: 'B.md C.md' });
    expect(m.edges).toContainEqual({ source: 'A.md B.md', target: 'C.md' });
    expect(m.edges).toHaveLength(2);
  });
});

describe('timelapse ordering', () => {
  it('orders notes oldest-first', () => {
    const m = buildGraphModel(notes, links, DEFAULT_GRAPH_CONFIG);
    expect(timelapseOrder(m.nodes)).toEqual(['C.md', 'A.md', 'B.md']);
  });

  it('reveals notes incrementally, pulling in derived neighbours', () => {
    const m = buildGraphModel(notes, links, cfg({ tags: true }));
    // Reveal C then A (oldest two). B stays hidden; A's tag node appears.
    const slice = timelapseSlice(m, 2);
    const ids = slice.nodes.map((n) => n.id).sort();
    expect(ids).toContain('C.md');
    expect(ids).toContain('A.md');
    expect(ids).toContain('tag:x');
    expect(ids).not.toContain('B.md'); // not yet revealed
    // The A→B edge is dropped because B isn't visible; A→tag:x survives.
    expect(slice.edges).toContainEqual({ source: 'A.md', target: 'tag:x' });
    expect(slice.edges).not.toContainEqual({ source: 'A.md', target: 'B.md' });
  });

  it('empty at 0, full at count', () => {
    const m = buildGraphModel(notes, links, DEFAULT_GRAPH_CONFIG);
    expect(timelapseSlice(m, 0).nodes).toEqual([]);
    expect(timelapseSlice(m, 3).nodes.map((n) => n.id).sort()).toEqual(['A.md', 'B.md', 'C.md']);
  });
});
