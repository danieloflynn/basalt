/**
 * Impure bridge between the vault services and the pure graph model: reads the
 * notes map + note contents, resolves every outgoing link, and (for local-graph
 * mode) restricts to a note's neighbourhood.
 */
import { parseFrontmatter } from '@/lib/frontmatter';
import { isMarkdownPath } from '@/lib/paths';
import { stripCode } from '@/lib/tags';
import { parseWikilinks } from '@/lib/wikilinks';
import { vaultService } from '@/services';
import { useVault } from '@/services/vault';
import type { RawLink, RawNote } from './model';

export interface GraphInput {
  notes: RawNote[];
  links: RawLink[];
}

/** All wikilink + markdown-link / embed targets in a note body (frontmatter + code stripped). */
function linkTargets(text: string): string[] {
  const body = stripCode(parseFrontmatter(text).body);
  const targets: string[] = [];
  for (const lk of parseWikilinks(body)) {
    if (lk.target.trim()) targets.push(lk.target);
  }
  for (const m of body.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // external URL / protocol
    try {
      const decoded = decodeURIComponent(href.replace(/^\.\//, ''));
      if (decoded.trim()) targets.push(decoded);
    } catch {
      // malformed percent-encoding — ignore
    }
  }
  return targets;
}

/**
 * Gather the raw notes + resolved links for the graph. With `path`, restrict to
 * that note's neighbourhood (itself + directly linked notes) while keeping links
 * out of those notes so tags/attachments/phantoms still attach.
 */
export function gatherGraphInput(path?: string): GraphInput {
  const notesMap = useVault.getState().notes;
  const allNotes: RawNote[] = [...notesMap.values()].map((n) => ({
    path: n.path,
    title: n.title,
    tags: n.tags,
    mtimeMs: n.mtimeMs,
  }));

  const allLinks: RawLink[] = [];
  for (const note of allNotes) {
    const text = vaultService.noteContent(note.path);
    if (text === undefined) continue;
    const seen = new Set<string>();
    for (const target of linkTargets(text)) {
      const key = target.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const resolved = vaultService.resolveLink(target, note.path);
      allLinks.push({
        from: note.path,
        target,
        resolved,
        resolvedIsMarkdown: resolved !== null && isMarkdownPath(resolved),
      });
    }
  }

  if (!path) return { notes: allNotes, links: allLinks };

  // Local mode: keep the focused note plus its direct note-note neighbours.
  const keep = new Set<string>([path]);
  for (const l of allLinks) {
    if (!l.resolvedIsMarkdown || !l.resolved) continue;
    if (l.from === path) keep.add(l.resolved);
    if (l.resolved === path) keep.add(l.from);
  }
  return {
    notes: allNotes.filter((n) => keep.has(n.path)),
    links: allLinks.filter((l) => keep.has(l.from)),
  };
}
