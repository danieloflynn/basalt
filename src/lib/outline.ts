import { stripCode } from './tags';

export interface HeadingInfo {
  level: number;
  text: string;
  /** 1-based line in the given source. */
  line: number;
  slug: string;
}

/** URL-safe anchor for a heading, matching what the reader renders as element ids. */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

/** All headings of a note (code fences excluded), for outlines and anchors. */
export function extractOutline(source: string): HeadingInfo[] {
  const scannable = stripCode(source);
  const out: HeadingInfo[] = [];
  const lines = scannable.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (m) {
      out.push({ level: m[1].length, text: m[2].trim(), line: i + 1, slug: slugifyHeading(m[2]) });
    }
  }
  return out;
}

/**
 * Remove %%comments%% (Obsidian-only text) outside code. Newlines inside a
 * comment are kept so source line numbers stay stable (task toggling relies
 * on them). Positions are found on a code-blanked copy so fences and inline
 * code are untouched.
 */
export function removeComments(source: string): string {
  const scannable = stripCode(source);
  let out = '';
  let pos = 0;
  for (;;) {
    const start = scannable.indexOf('%%', pos);
    if (start === -1) break;
    const end = scannable.indexOf('%%', start + 2);
    if (end === -1) break;
    out += source.slice(pos, start);
    out += source.slice(start, end + 2).replace(/[^\n]/g, '');
    pos = end + 2;
  }
  out += source.slice(pos);
  return out;
}

/** Extract the block (paragraph or list item) tagged with ^blockId. */
export function extractBlock(source: string, blockId: string): string | null {
  const lines = source.split('\n');
  const marker = new RegExp(`\\^${escapeRegExp(blockId)}\\s*$`);
  const at = lines.findIndex((l) => marker.test(l));
  if (at === -1) return null;

  // Expand to the contiguous non-blank run around the tagged line.
  let start = at;
  while (start > 0 && lines[start - 1].trim() !== '') start--;
  let end = at;
  while (end < lines.length - 1 && lines[end + 1].trim() !== '') end++;
  return lines
    .slice(start, end + 1)
    .join('\n')
    .replace(marker, '')
    .trimEnd();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
