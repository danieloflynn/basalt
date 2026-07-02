import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface Frontmatter {
  /** Parsed YAML mapping; {} when absent or invalid. */
  data: Record<string, unknown>;
  /** Note body with the frontmatter block removed. */
  body: string;
  /** The raw block between the --- fences, or null when absent. */
  raw: string | null;
}

const FM_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function parseFrontmatter(src: string): Frontmatter {
  const match = FM_PATTERN.exec(src);
  if (!match) return { data: {}, body: src, raw: null };

  const raw = match[1];
  try {
    const parsed = parseYaml(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      // Valid YAML but not a mapping — Obsidian treats this as no properties.
      return { data: {}, body: src.slice(match[0].length), raw };
    }
    return { data: parsed as Record<string, unknown>, body: src.slice(match[0].length), raw };
  } catch {
    // Invalid YAML: leave the note untouched rather than guessing.
    return { data: {}, body: src, raw: null };
  }
}

export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  if (Object.keys(data).length === 0) return body;
  return `---\n${stringifyYaml(data).trimEnd()}\n---\n${body}`;
}
