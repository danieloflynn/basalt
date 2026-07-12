import { stripCode } from './tags';

export interface WikilinkRewriteOpts {
  /** Basename (no folder, no extension) to substitute for matched links. */
  newBase: string;
  /**
   * Folder qualifier for rewritten links (moves): the vault-absolute folder
   * the note now lives in, '' for the vault root (qualifier stripped). When
   * undefined (renames-in-place), each link's written qualifier is preserved.
   */
  newDir?: string;
  /**
   * Whether a link whose target (as written, trimmed, without heading/alias)
   * is `target` should be repointed. Callers back this with the vault resolver
   * so only links that actually resolve to the renamed note are touched — a
   * `[[Old]]` aimed at a different note with the same basename is respected.
   */
  shouldRewrite: (target: string) => boolean;
  /**
   * Ambiguity guard, consulted only for a rewritten link whose computed folder
   * qualifier is EMPTY (a bare `[[newBase]]`). Given the link's written target,
   * return a folder to qualify with (e.g. 'A' -> `[[A/newBase]]`) when a bare
   * basename would now resolve to the WRONG note; return null/'' to leave the
   * link bare. Lets renameByTitle qualify exactly the inbound links a same-named
   * note elsewhere in the vault would otherwise capture.
   */
  qualifyBare?: (target: string) => string | null | undefined;
}

const LINK_RE = /(!)?\[\[([^[\]\n]+?)\]\]/g;

/** Index of the first `|` in `inner` that is not backslash-escaped, or -1. */
function unescapedPipe(inner: string): number {
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\') {
      i++;
      continue;
    }
    if (inner[i] === '|') return i;
  }
  return -1;
}

/**
 * Repoint `[[wikilinks]]` (and `![[embeds]]`) that resolve to a renamed note,
 * swapping the basename (and, for moves, the folder qualifier via `newDir`)
 * while preserving a written `.md` suffix, `#heading` / `#^block` references
 * and `|alias`. Fenced blocks and inline code spans are left untouched, as are
 * empty (`[[#heading]]` self) targets, escaped-pipe targets that don't resolve,
 * and any link `shouldRewrite` rejects. Conservative by construction: corrupting
 * vault text is the worst possible outcome, so when in doubt we skip.
 */
export function rewriteWikilinks(text: string, opts: WikilinkRewriteOpts): string {
  const masked = stripCode(text); // code blanked to spaces; indices preserved
  let out = '';
  let last = 0;
  for (const m of masked.matchAll(LINK_RE)) {
    const start = m.index ?? 0;
    // Outside code, masked === original here, so m[2] is the real inner text.
    const inner = m[2];
    const pipe = unescapedPipe(inner);
    const targetPart = pipe === -1 ? inner : inner.slice(0, pipe);
    const hash = targetPart.indexOf('#');
    const pathPart = hash === -1 ? targetPart : targetPart.slice(0, hash);
    const target = pathPart.trim();
    if (!target || !opts.shouldRewrite(target)) continue;

    const slash = pathPart.lastIndexOf('/');
    let dir =
      opts.newDir === undefined
        ? slash === -1
          ? ''
          : pathPart.slice(0, slash + 1)
        : opts.newDir
          ? `${opts.newDir}/`
          : '';
    if (dir === '' && opts.qualifyBare) {
      const q = opts.qualifyBare(target);
      if (q) dir = `${q}/`;
    }
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

export interface MarkdownLinkRewriteOpts {
  /** New basename + extension (no folder), e.g. 'New Note.md' or 'img 2.png'. */
  newName: string;
  /**
   * Folder qualifier for the rewritten target (moves): '' for the vault root.
   * When undefined (renames-in-place), the link's written folder is preserved.
   */
  newDir?: string;
  /**
   * Whether a link whose decoded path (folder + name, sans `#fragment` and a
   * leading `./`) should be repointed. Backed by the vault resolver.
   */
  shouldRewrite: (decodedPath: string) => boolean;
  /** Ambiguity guard for links written bare — see WikilinkRewriteOpts.qualifyBare. */
  qualifyBare?: (decodedPath: string) => string | null | undefined;
}

const MD_LINK_RE = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g;

/** Encode a vault path the way an already-percent-encoded target was written. */
function encodePath(p: string): string {
  return p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/**
 * Repoint markdown-style links / embeds `[text](Old%20Note.md)` and
 * `![](A/img.png)` that resolve to a renamed or moved file. Preserves the
 * URL-encoding style (percent-encoded stays encoded, literal stays literal),
 * the `#fragment`, the `!` embed prefix and the link text. Absolute URLs
 * (`scheme:`), protocol-relative (`//`) and in-page (`#…`) targets, plus links
 * inside code, are skipped.
 */
export function rewriteMarkdownLinks(text: string, opts: MarkdownLinkRewriteOpts): string {
  const masked = stripCode(text);
  let out = '';
  let last = 0;
  for (const m of masked.matchAll(MD_LINK_RE)) {
    const start = m.index ?? 0;
    const rawTarget = m[3];
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget) || rawTarget.startsWith('#') || rawTarget.startsWith('//')) {
      continue;
    }
    const hashIdx = rawTarget.indexOf('#');
    const rawPath = hashIdx === -1 ? rawTarget : rawTarget.slice(0, hashIdx);
    const frag = hashIdx === -1 ? '' : rawTarget.slice(hashIdx);
    if (!rawPath) continue;

    const encoded = /%[0-9a-f]{2}/i.test(rawPath);
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      decoded = rawPath;
    }
    const hadDotSlash = decoded.startsWith('./');
    const decodedPath = hadDotSlash ? decoded.slice(2) : decoded;
    if (!opts.shouldRewrite(decodedPath)) continue;

    const slash = decodedPath.lastIndexOf('/');
    let dir =
      opts.newDir === undefined
        ? slash === -1
          ? ''
          : decodedPath.slice(0, slash + 1)
        : opts.newDir
          ? `${opts.newDir}/`
          : '';
    if (dir === '' && opts.qualifyBare) {
      const q = opts.qualifyBare(decodedPath);
      if (q) dir = `${q}/`;
    }
    const newDecoded = `${hadDotSlash && dir === '' ? './' : ''}${dir}${opts.newName}`;
    const newTarget = (encoded ? encodePath(newDecoded) : newDecoded) + frag;

    // Rebuild from the ORIGINAL match so an inline-code label survives intact.
    const original = text.slice(start, start + m[0].length);
    const prefix = original.slice(0, original.length - (rawTarget.length + 2));
    out += text.slice(last, start) + `${prefix}(${newTarget})`;
    last = start + m[0].length;
  }
  return out + text.slice(last);
}
