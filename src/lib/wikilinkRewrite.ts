import { stripCode } from './tags';

export interface WikilinkRewriteOpts {
  /** Basename (no folder, no extension) to substitute for matched links. */
  newBase: string;
  /**
   * Whether a link whose target (as written, trimmed, without heading/alias)
   * is `target` should be repointed. Callers back this with the vault resolver
   * so only links that actually resolve to the renamed note are touched — a
   * `[[Old]]` aimed at a different note with the same basename is respected.
   */
  shouldRewrite: (target: string) => boolean;
}

const LINK_RE = /(!)?\[\[([^[\]\n]+?)\]\]/g;

/**
 * Repoint `[[wikilinks]]` (and `![[embeds]]`) that resolve to a renamed note,
 * swapping only the basename while preserving folder qualifier, a written `.md`
 * suffix, `#heading` / `#^block` references and `|alias`. Fenced blocks and
 * inline code spans are left untouched, as are empty (`[[#heading]]` self)
 * targets and any link `shouldRewrite` rejects. Conservative by construction:
 * corrupting vault text is the worst possible outcome, so when in doubt we skip.
 */
export function rewriteWikilinks(text: string, opts: WikilinkRewriteOpts): string {
  const masked = stripCode(text); // code blanked to spaces; indices preserved
  let out = '';
  let last = 0;
  for (const m of masked.matchAll(LINK_RE)) {
    const start = m.index ?? 0;
    // Outside code, masked === original here, so m[2] is the real inner text.
    const inner = m[2];
    const pipe = inner.indexOf('|');
    const targetPart = pipe === -1 ? inner : inner.slice(0, pipe);
    const hash = targetPart.indexOf('#');
    const pathPart = hash === -1 ? targetPart : targetPart.slice(0, hash);
    const target = pathPart.trim();
    if (!target || !opts.shouldRewrite(target)) continue;

    const slash = pathPart.lastIndexOf('/');
    const dir = slash === -1 ? '' : pathPart.slice(0, slash + 1);
    const hadMd = /\.md\s*$/i.test(pathPart.slice(slash + 1));
    const newInner =
      `${dir}${opts.newBase}${hadMd ? '.md' : ''}` +
      (hash === -1 ? '' : targetPart.slice(hash)) +
      (pipe === -1 ? '' : inner.slice(pipe));

    out += text.slice(last, start) + `${m[1] ?? ''}[[${newInner}]]`;
    last = start + m[0].length;
  }
  return out + text.slice(last);
}
