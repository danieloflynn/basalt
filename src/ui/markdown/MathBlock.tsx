import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useMemo } from 'react';

/** KaTeX renderer — this module is lazy-loaded so KaTeX stays out of the main bundle. */
export default function MathBlock({ tex, display }: { tex: string; display: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: false });
    } catch {
      return null;
    }
  }, [tex, display]);

  if (html === null) return <code>{tex}</code>;
  return display ? (
    <span
      className="math-display-block"
      style={{ display: 'block', overflowX: 'auto', padding: '4px 0' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  );
}
