import { beforeEach, describe, expect, it } from 'vitest';
import { useVault, vaultService } from './vault';
import { getVaultFS } from '@/engine';
import { memoryStore } from '@/engine/mock';

/** Reset the shared in-memory vault, seed files, and (re)build the service caches. */
async function setup(files: Record<string, string>): Promise<void> {
  memoryStore.files.clear();
  memoryStore.dirty.clear();
  const t = Date.now();
  for (const [p, text] of Object.entries(files)) memoryStore.files.set(p, { text, mtimeMs: t });
  useVault.setState({ recents: [], bookmarks: [] });
  await vaultService.initialize();
}

const read = (p: string): string | undefined => memoryStore.files.get(p)?.text;
const exists = (p: string): boolean => memoryStore.files.has(p);

beforeEach(() => {
  memoryStore.files.clear();
  memoryStore.dirty.clear();
});

// ---------------------------------------------------------------------------
// Fix 1 — central sanitizeNoteTitle
// ---------------------------------------------------------------------------
describe('fix 1: title sanitizer', () => {
  it('replaces pipe/brackets/hash traps and rewrites inbound links safely', async () => {
    await setup({ 'Old.md': '# Old', 'Ref.md': 'see [[Old]]' });
    // '|', ']', ']', '#' each map to '-' -> A-B---C
    const to = await vaultService.renameByTitle('Old.md', 'A|B]]#C');
    expect(to).toBe('A-B---C.md');
    expect(exists('A-B---C.md')).toBe(true);
    expect(read('Ref.md')).toBe('see [[A-B---C]]');
  });

  it('maps a dot-only title to Untitled (no ..md hidden path)', async () => {
    await setup({ 'Note.md': 'x' });
    const to = await vaultService.renameByTitle('Note.md', '.');
    expect(to).toBe('Untitled.md');
    expect(exists('..md')).toBe(false);
  });

  it('strips leading dots so `.draft` is not a hidden note', async () => {
    await setup({ 'Note.md': 'x' });
    const to = await vaultService.renameByTitle('Note.md', '.draft');
    expect(to).toBe('draft.md');
  });

  it('sanitizes createNote names too (QuickOpen / wikilink-tap flow)', async () => {
    await setup({});
    expect(await vaultService.createNote('', 'a/b:c')).toBe('a-b-c.md');
  });

  it('leaves an empty typed title as a no-op (does not rename to Untitled)', async () => {
    await setup({ 'Keep.md': 'x' });
    expect(await vaultService.renameByTitle('Keep.md', '   ')).toBe('Keep.md');
    expect(exists('Keep.md')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix 2 — write-through contents cache
// ---------------------------------------------------------------------------
describe('fix 2: write-through cache', () => {
  it('updates the contents cache BEFORE awaiting fs.write (no stale read mid-write)', async () => {
    await setup({ 'A.md': 'old' });
    const fs = getVaultFS();
    const orig = fs.write.bind(fs);
    let seenDuringWrite: string | undefined;
    fs.write = async (path: string, text: string) => {
      // While the disk write is in flight, the cache must already be fresh.
      if (path === 'A.md') seenDuringWrite = vaultService.noteContent('A.md');
      return orig(path, text);
    };
    try {
      await vaultService.writeNote('A.md', 'new');
    } finally {
      fs.write = orig;
    }
    expect(seenDuringWrite).toBe('new');
    expect(await vaultService.readNote('A.md')).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — structural-op mutex
// ---------------------------------------------------------------------------
describe('fix 3: structural-op mutex', () => {
  it('serializes a concurrent rename + write so caches stay consistent with disk', async () => {
    await setup({ 'A.md': 'aaa', 'B.md': 'bbb', 'Ref.md': 'see [[A]]' });
    const [toA] = await Promise.all([
      vaultService.renameByTitle('A.md', 'A2'),
      vaultService.writeNote('B.md', 'bbb updated'),
    ]);
    expect(toA).toBe('A2.md');
    expect(exists('A2.md')).toBe(true);
    expect(exists('A.md')).toBe(false);
    expect(read('B.md')).toBe('bbb updated');
    expect(read('Ref.md')).toBe('see [[A2]]');
    // The notes map (a derived cache) must match the markdown files on disk.
    const notePaths = [...useVault.getState().notes.keys()].sort();
    const diskMd = [...memoryStore.files.keys()].filter((p) => p.endsWith('.md')).sort();
    expect(notePaths).toEqual(diskMd);
  });

  it('a write racing a rename of the SAME note leaves no phantom index entry', async () => {
    await setup({ 'Old.md': 'x' });
    await Promise.allSettled([
      vaultService.renameByTitle('Old.md', 'New'),
      vaultService.writeNote('Old.md', 'x + late keystroke'),
    ]);
    expect(exists('New.md')).toBe(true);
    // Every note the index/notes-map believes in must actually exist on disk.
    for (const p of useVault.getState().notes.keys()) expect(exists(p)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix 4 — stripCode under-masking (via a real rename)
// ---------------------------------------------------------------------------
describe('fix 4: rename respects an unclosed fence', () => {
  it('does not rewrite links inside a fence that runs to EOF', async () => {
    await setup({
      'Old.md': '# Old',
      'Ref.md': 'live [[Old]]\n```\nfenced [[Old]] to eof',
    });
    await vaultService.renameByTitle('Old.md', 'New');
    expect(read('Ref.md')).toBe('live [[New]]\n```\nfenced [[Old]] to eof');
  });
});

// ---------------------------------------------------------------------------
// Fix 5 — ambiguity-aware rewriting
// ---------------------------------------------------------------------------
describe('fix 5: ambiguity-aware rewriting', () => {
  it('(b) renameByTitle qualifies inbound links a same-named note would capture', async () => {
    await setup({
      'A/Old.md': '# Old',
      'B/New.md': '# other New',
      'B/Ref.md': 'see [[Old]]',
    });
    await vaultService.renameByTitle('A/Old.md', 'New');
    expect(read('B/Ref.md')).toBe('see [[A/New]]');
  });

  it('(a) moveFile qualifies a bare link the move would make ambiguous', async () => {
    await setup({
      'A/Note.md': '# note',
      'B/Note.md': '# other',
      'A/Ref.md': 'see [[Note]]',
    });
    expect(await vaultService.moveFile('A/Note.md', 'D')).toBe('D/Note.md');
    expect(read('A/Ref.md')).toBe('see [[D/Note]]');
  });

  it('leaves a bare link bare when it still resolves after the move', async () => {
    await setup({ 'A/Note.md': '# note', 'A/Ref.md': 'see [[Note]]' });
    await vaultService.moveFile('A/Note.md', 'D');
    expect(read('A/Ref.md')).toBe('see [[Note]]');
  });

  it('respects a prefix collision (renaming Old does not touch [[Old Note]])', async () => {
    await setup({
      'Old.md': '# Old',
      'Old Note.md': '# Old Note',
      'Ref.md': 'this [[Old]] and that [[Old Note]]',
    });
    await vaultService.renameByTitle('Old.md', 'New');
    expect(read('Ref.md')).toBe('this [[New]] and that [[Old Note]]');
  });
});

// ---------------------------------------------------------------------------
// Fix 6 — case-insensitive create/attachment dedupe
// ---------------------------------------------------------------------------
describe('fix 6: case-insensitive dedupe', () => {
  it('createNote does not truncate a differently-cased existing note', async () => {
    await setup({ 'untitled.md': 'existing content' });
    expect(await vaultService.createNote('', 'Untitled')).toBe('Untitled 2.md');
    expect(read('untitled.md')).toBe('existing content');
  });

  it('saveAttachment dedupes case-insensitively', async () => {
    await setup({ 'attachments/img.png': 'A' });
    const p = await vaultService.saveAttachment('attachments', 'IMG.PNG', 'ignored');
    expect(p).toBe('attachments/IMG 2.PNG');
    expect(read('attachments/img.png')).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// Fix 7 — markdown-style links rewritten
// ---------------------------------------------------------------------------
describe('fix 7: markdown-style links', () => {
  it('rewrites encoded markdown links + embeds on rename', async () => {
    await setup({
      'Old Note.md': '# Old',
      'Ref.md': 'a [text](Old%20Note.md) and ![](Old%20Note.md)',
    });
    await vaultService.renameByTitle('Old Note.md', 'New Note');
    expect(read('Ref.md')).toBe('a [text](New%20Note.md) and ![](New%20Note.md)');
  });

  it('rewrites a markdown image link on move', async () => {
    await setup({ 'A/img.png': 'x', 'Ref.md': '![alt](A/img.png)' });
    await vaultService.moveFile('A/img.png', 'B');
    expect(read('Ref.md')).toBe('![alt](B/img.png)');
  });
});

// ---------------------------------------------------------------------------
// Fix 8 — renameFolder + renameFile overwrite guard
// ---------------------------------------------------------------------------
describe('fix 8: renameFolder + overwrite guard', () => {
  it('moves every child incl. a hidden .gitkeep and repoints qualified links', async () => {
    await setup({
      'Proj/A.md': '# A',
      'Proj/sub/B.md': '# B',
      'Proj/.gitkeep': '',
      'Ref.md': 'see [[Proj/A]] and [[Proj/sub/B]] and bare [[A]]',
    });
    const moves = await vaultService.renameFolder('Proj', 'Project');
    expect(exists('Project/A.md')).toBe(true);
    expect(exists('Project/sub/B.md')).toBe(true);
    expect(exists('Project/.gitkeep')).toBe(true);
    expect(exists('Proj/A.md')).toBe(false);
    expect(exists('Proj/.gitkeep')).toBe(false);
    expect(read('Ref.md')).toBe('see [[Project/A]] and [[Project/sub/B]] and bare [[A]]');
    expect(moves).toHaveLength(3);
  });

  it('dedupes the new folder name against an existing sibling folder', async () => {
    await setup({ 'Proj/A.md': 'x', 'Done/B.md': 'y' });
    const moves = await vaultService.renameFolder('Proj', 'Done');
    expect(exists('Done 2/A.md')).toBe(true);
    expect(moves[0].to).toBe('Done 2/A.md');
  });

  it('renameFile throws instead of overwriting an existing destination', async () => {
    await setup({ 'A.md': 'aaa', 'B.md': 'bbb' });
    await expect(vaultService.renameFile('A.md', 'B.md')).rejects.toThrow();
    expect(read('A.md')).toBe('aaa');
    expect(read('B.md')).toBe('bbb');
  });
});

// ---------------------------------------------------------------------------
// Fix 9 — delete hygiene
// ---------------------------------------------------------------------------
describe('fix 9: delete hygiene', () => {
  it('deleteFolder purges attachments from the resolver and children from recents', async () => {
    await setup({ 'A/note.md': 'x', 'A/img.png': 'y', 'Ref.md': 'link' });
    await vaultService.readNote('A/note.md');
    expect(useVault.getState().recents).toContain('A/note.md');
    expect(vaultService.resolveLink('img.png', 'Ref.md')).toBe('A/img.png');
    await vaultService.deleteFolder('A');
    expect(vaultService.resolveLink('img.png', 'Ref.md')).toBeNull();
    expect(useVault.getState().recents).not.toContain('A/note.md');
  });
});

// ---------------------------------------------------------------------------
// Fix 10 — bookmarks (groups + delete)
// ---------------------------------------------------------------------------
describe('fix 10: bookmarks', () => {
  it('migrates a bookmark nested inside an Obsidian group on rename', async () => {
    await setup({
      'Old.md': 'x',
      '.obsidian/bookmarks.json': JSON.stringify({
        items: [{ type: 'group', title: 'G', items: [{ type: 'file', path: 'Old.md' }] }],
      }),
    });
    await vaultService.renameByTitle('Old.md', 'New');
    const bm = JSON.parse(read('.obsidian/bookmarks.json')!);
    expect(bm.items[0].items[0].path).toBe('New.md');
  });

  it('drops a dangling file bookmark on delete', async () => {
    await setup({
      'A.md': 'x',
      '.obsidian/bookmarks.json': JSON.stringify({ items: [{ type: 'file', path: 'A.md' }] }),
    });
    await vaultService.deleteFile('A.md');
    const bm = JSON.parse(read('.obsidian/bookmarks.json')!);
    expect(bm.items.some((i: { path?: string }) => i.path === 'A.md')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fix 11 — backlink context line
// ---------------------------------------------------------------------------
describe('fix 11: backlink context', () => {
  it('picks the line that actually links to the note, not a bare substring', async () => {
    await setup({
      'a.md': '# a',
      'Ref.md': 'the word a appears here\nand here is the [[a]] link\nmore a',
    });
    const bl = vaultService.backlinksOf('a.md');
    expect(bl).toHaveLength(1);
    expect(bl[0].context).toBe('and here is the [[a]] link');
  });
});

// ---------------------------------------------------------------------------
// Backlink occurrence counts (desktop linked-mentions badges)
// ---------------------------------------------------------------------------
describe('backlink occurrence counts', () => {
  it('lists one context per link occurrence, in document order', async () => {
    await setup({
      'Target.md': '# t',
      'Twice.md': 'first [[Target]] here\nthen [[Target]] and [[Target]] on one line',
      'Once.md': 'just [[Target]]',
    });
    const bl = vaultService.backlinksOf('Target.md');
    const twice = bl.find((b) => b.path === 'Twice.md')!;
    expect(twice.contexts).toHaveLength(3);
    expect(twice.contexts[0]).toBe('first [[Target]] here');
    // a line linking twice is listed once per occurrence
    expect(twice.contexts[1]).toBe(twice.contexts[2]);
    expect(twice.context).toBe(twice.contexts[0]);
    expect(bl.find((b) => b.path === 'Once.md')!.contexts).toHaveLength(1);
  });

  it('counts aliased wikilinks and markdown links too', async () => {
    await setup({
      'Target.md': '# t',
      'Mixed.md': 'alias [[Target|see this]]\nmd [link](Target.md)',
    });
    const bl = vaultService.backlinksOf('Target.md');
    expect(bl[0].contexts).toHaveLength(2);
  });
});
