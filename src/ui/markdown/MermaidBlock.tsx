import { useEffect, useRef, useState } from 'react';

let seq = 0;

/** Mermaid renderer — lazy-loaded; the mermaid library is ~1MB and only fetched on first diagram. */
export default function MermaidBlock({ source }: { source: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`basalt-mermaid-${++seq}`);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          theme: document.documentElement.dataset.theme === 'light' ? 'neutral' : 'dark',
          securityLevel: 'strict',
        });
        const { svg } = await mermaid.render(idRef.current, source);
        if (!cancelled) setSvg(svg);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (failed) {
    return (
      <pre>
        <code>{source}</code>
      </pre>
    );
  }
  if (svg === null) {
    return <span className="embed" style={{ display: 'block', minHeight: 60 }} />;
  }
  return (
    <span
      style={{ display: 'block', overflowX: 'auto' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
