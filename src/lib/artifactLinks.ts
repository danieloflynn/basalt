import { parseWikilinks } from './wikilinks';

/**
 * Click bridge injected into every rendered artifact. The iframe has no
 * same-origin access, so link taps are relayed to the app via postMessage;
 * the app decides what a href means (vault note, artifact, external URL).
 * In-page #fragment anchors keep their native behavior, and the artifact's
 * own click handlers still run — only default navigation is prevented.
 */
const BRIDGE_SCRIPT = `<script>
(function () {
  document.addEventListener('click', function (e) {
    var el = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!el) return;
    var href = el.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return;
    e.preventDefault();
    try { window.parent.postMessage({ type: 'basalt:link', href: href }, '*'); } catch (err) {}
  }, true);
})();
<\/script>`;

/** Prepare artifact HTML for the sandboxed frame: install the click bridge. */
export function injectArtifactBridge(html: string): string {
  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + BRIDGE_SCRIPT + html.slice(at);
  }
  return BRIDGE_SCRIPT + html;
}

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
