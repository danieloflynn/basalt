import { parseFrontmatter } from './frontmatter';

const TAG_PATTERN = /(^|[\s(])#([A-Za-z0-9_/-]*[A-Za-z_/-][A-Za-z0-9_/-]*)/g;

/** Extract unique tags from a note (frontmatter `tags` + inline #tags outside code). */
export function extractTags(src: string): string[] {
  const { data, body } = parseFrontmatter(src);
  const seen = new Map<string, string>();

  for (const tag of frontmatterTags(data)) {
    const clean = tag.replace(/^#/, '').trim();
    if (clean) seen.set(clean.toLowerCase(), clean);
  }

  const scannable = stripCode(body);
  for (const match of scannable.matchAll(TAG_PATTERN)) {
    const tag = match[2];
    if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  }
  return [...seen.values()];
}

function frontmatterTags(data: Record<string, unknown>): string[] {
  const value = data.tags ?? data.tag;
  if (typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean);
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

/**
 * Blank out fenced and inline code so scanners don't match inside it.
 *
 * Length- and offset-preserving: masked characters become spaces, newlines are
 * kept, so callers (rewriteWikilinks, linksIn, extractTags) can map matches in
 * the masked text straight back onto the original. A small line scanner tracks
 * CommonMark-ish fences — backtick OR tilde, run length >= 3, up to 3 spaces of
 * indent, optional `>` blockquote prefixes, closed by a same-char run at least
 * as long in the same-or-looser blockquote context (unclosed runs to EOF) — and
 * matches inline backtick spans by equal run length (so ``[[x]]`` masks too).
 */
export function stripCode(body: string): string {
  const lines = body.split('\n');
  let fence: { char: string; len: number; quote: number } | null = null;
  const out = lines.map((line) => {
    const info = parseFence(line);
    if (fence) {
      const masked = blank(line);
      if (
        info &&
        info.char === fence.char &&
        info.len >= fence.len &&
        info.text === '' &&
        info.quote <= fence.quote
      ) {
        fence = null; // this line is the closing fence (still masked)
      }
      return masked;
    }
    if (info) {
      fence = { char: info.char, len: info.len, quote: info.quote };
      return blank(line);
    }
    return maskInline(line);
  });
  return out.join('\n');
}

/** Replace every non-newline char with a space (line has no newline here). */
function blank(line: string): string {
  return ' '.repeat(line.length);
}

/** Parse a line as a possible code fence, accounting for blockquote nesting. */
function parseFence(
  line: string,
): { char: string; len: number; text: string; quote: number } | null {
  let rest = line;
  let quote = 0;
  for (;;) {
    const m = /^ {0,3}> ?/.exec(rest);
    if (!m) break;
    quote++;
    rest = rest.slice(m[0].length);
  }
  const m = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(rest);
  if (!m) return null;
  const char = m[2][0];
  const text = m[3];
  // A backtick fence's info string may not itself contain a backtick.
  if (char === '`' && text.includes('`')) return null;
  return { char, len: m[2].length, text: text.trim(), quote };
}

/** Mask inline code spans on a single line, pairing backtick runs of equal length. */
function maskInline(line: string): string {
  const chars = [...line];
  let i = 0;
  while (i < chars.length) {
    if (chars[i] !== '`') {
      i++;
      continue;
    }
    let j = i;
    while (j < chars.length && chars[j] === '`') j++;
    const runLen = j - i;
    // Find the next backtick run of exactly runLen (shorter/longer runs are content).
    let k = j;
    let closeEnd = -1;
    while (k < chars.length) {
      if (chars[k] !== '`') {
        k++;
        continue;
      }
      let l = k;
      while (l < chars.length && chars[l] === '`') l++;
      if (l - k === runLen) {
        closeEnd = l;
        break;
      }
      k = l;
    }
    if (closeEnd === -1) {
      i = j; // no matching close: the run is literal, skip past it
    } else {
      for (let p = i; p < closeEnd; p++) chars[p] = ' ';
      i = closeEnd;
    }
  }
  return chars.join('');
}
