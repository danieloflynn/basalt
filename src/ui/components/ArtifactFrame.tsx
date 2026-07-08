import { Browser } from '@capacitor/browser';
import { useEffect, useMemo, useRef } from 'react';
import { injectArtifactBridge } from '@/lib/artifactLinks';
import { isHtmlPath, isMarkdownPath, noteTitle } from '@/lib/paths';
import { vaultService } from '@/services';
import { openNote, useNav } from '@/state/nav';

/**
 * The sandboxed iframe every artifact renders in (full-screen viewer and
 * inline embeds). Sandbox has NO allow-same-origin — artifact scripts can
 * never reach the app; the only channel back is the injected click bridge,
 * whose messages are treated purely as link targets and resolved against
 * the vault.
 */
export function ArtifactFrame({ path, html, className }: {
  path: string;
  html: string;
  className: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const doc = useMemo(() => injectArtifactBridge(html), [html]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return; // only our frame
      const data = e.data as { type?: unknown; href?: unknown } | null;
      if (data?.type !== 'basalt:link' || typeof data.href !== 'string') return;
      openArtifactHref(data.href, path);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [path]);

  return (
    <iframe
      ref={ref}
      className={className}
      title={noteTitle(path)}
      sandbox="allow-scripts allow-forms allow-modals allow-popups"
      srcDoc={doc}
    />
  );
}

/** A tapped href from inside an artifact: external → system browser, vault → open in-app. */
function openArtifactHref(href: string, fromPath: string): void {
  if (/^https?:/i.test(href)) {
    void Browser.open({ url: href });
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return; // other schemes: inert
  const [bare, fragment] = href.split('#');
  const target = decode(bare.split('?')[0]);
  if (!target) return;
  const resolved = vaultService.resolveLink(target, fromPath);
  if (!resolved) return;
  if (isMarkdownPath(resolved)) openNote(resolved, fragment ? decode(fragment) : undefined);
  else if (isHtmlPath(resolved)) useNav.getState().push({ name: 'artifact', path: resolved });
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
