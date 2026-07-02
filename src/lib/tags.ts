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

/** Blank out fenced and inline code so scanners don't match inside it. */
export function stripCode(body: string): string {
  return body
    .replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}
