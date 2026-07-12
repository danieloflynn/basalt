/**
 * Impure bridge between the vault services and the pure graph model: reads the
 * notes map + note contents, resolves every outgoing link, and (for local-graph
 * mode) restricts to a note's neighbourhood.
 */
import { parseFrontmatter } from '@/lib/frontmatter';
import { isHiddenPath, isHtmlPath, isMarkdownPath, noteTitle } from '@/lib/paths';
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

  // HTML artifacts are first-class graph nodes (files, not notes — hence sourced
  // from the file list, no tags). They carry a real mtime for the timelapse.
  for (const f of useVault.getState().files) {
    if (!isHtmlPath(f.path) || isHiddenPath(f.path)) continue;
    allNotes.push({ path: f.path, title: noteTitle(f.path), tags: [], mtimeMs: f.mtimeMs, isArtifact: true });
  }

  const allLinks: RawLink[] = [];
  for (const note of allNotes) {
    // Artifact edges come from the vault's link index (below), not body parsing.
    if (note.isArtifact) continue;
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

  // Artifact outgoing edges: <a href>/[[wikilink]] targets in the HTML source,
  // already resolved to graph nodes (notes + artifacts — no attachment/phantom
  // targets) by the vault's link index. `resolved` is non-null, so these never
  // become phantom nodes; the target label is unused.
  for (const note of allNotes) {
    if (!note.isArtifact) continue;
    for (const resolved of vaultService.outgoingOf(note.path)) {
      allLinks.push({
        from: note.path,
        target: resolved,
        resolved,
        resolvedIsMarkdown: isMarkdownPath(resolved),
      });
    }
  }

  if (!path) return { notes: allNotes, links: allLinks };

  // Local mode: keep the focused node plus its direct graph-node neighbours
  // (notes and artifacts alike — membership in the graph-node set is the gate).
  const graphPaths = new Set(allNotes.map((n) => n.path));
  const keep = new Set<string>([path]);
  for (const l of allLinks) {
    if (!l.resolved || !graphPaths.has(l.resolved)) continue;
    if (l.from === path) keep.add(l.resolved);
    if (l.resolved === path) keep.add(l.from);
  }
  return {
    notes: allNotes.filter((n) => keep.has(n.path)),
    // Keep links OUT of the focused neighbourhood so tags/attachments/phantoms
    // still attach, but DROP links pointing at a graph node we aren't showing.
    // Otherwise a second-degree artifact — whose node-node edge can't form (it's
    // not kept) — would fall through to the attachment branch (`noteByPath`, the
    // model's graph-node set, is only the kept nodes in local mode) and render as
    // a stray "attachment". Links to real attachments/phantoms are untouched.
    links: allLinks.filter(
      (l) => keep.has(l.from) && !(l.resolved !== null && graphPaths.has(l.resolved) && !keep.has(l.resolved)),
    ),
  };
}
