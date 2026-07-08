import { parseWikilinks } from './wikilinks';

/**
 * Raw link targets inside an HTML artifact, for the vault link graph:
 * `href` values of `<a>` tags plus any `[[wikilinks]]` in the source (so an
 * artifact can reference notes invisibly, e.g. from an HTML comment).
 * External URLs (scheme:) and pure-fragment hrefs are skipped. Targets are
 * returned as written — resolution against the vault is the caller's job.
 */
export function extractArtifactLinks(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const target = raw.trim();
    if (target && !seen.has(target)) {
      seen.add(target);
      out.push(target);
    }
  };

  for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const href = (m[1] ?? m[2] ?? '').trim();
    if (!href || href.startsWith('#')) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // external scheme
    const bare = href.split('#')[0].split('?')[0];
    try {
      push(decodeURIComponent(bare));
    } catch {
      push(bare);
    }
  }

  for (const link of parseWikilinks(html)) {
    if (link.target) push(link.target);
  }

  return out;
}
