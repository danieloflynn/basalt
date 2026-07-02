import { useEffect, useMemo, useRef, useState } from 'react';
import { vaultService, useVault } from '@/services';
import { openNote, useNav } from '@/state/nav';
import { IconBack, IconNote, IconSearch } from '@/ui/icons';

/** Combined quick-open + full-text search (SE-1..SE-4). */
export function SearchScreen({ initialQuery = '' }: { initialQuery?: string }) {
  const nav = useNav();
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const indexVersion = useVault((s) => s.indexVersion);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  const isTagQuery = query.trim().startsWith('#');

  const quick = useMemo(
    () => (isTagQuery ? [] : vaultService.quickOpen(query)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, isTagQuery, indexVersion],
  );

  const fullText = useMemo(() => {
    if (isTagQuery) return [];
    if (!query.trim()) return [];
    const quickPaths = new Set(quick.map((n) => n.path));
    return vaultService.searchNotes(query).filter((h) => !quickPaths.has(h.path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, quick, isTagQuery, indexVersion]);

  const tagged = useMemo(
    () => (isTagQuery ? vaultService.notesWithTag(query.trim().slice(1)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, isTagQuery, indexVersion],
  );

  const open = (path: string) => {
    openNote(path);
  };

  return (
    <div className="screen screen--overlay">
      <div className="search-head">
        <button className="iconbtn" aria-label="Back" onClick={() => nav.back()}>
          <IconBack />
        </button>
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Search notes, or #tag"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
        />
      </div>

      <div className="scroll">
        {isTagQuery && (
          <div className="rowlist">
            {tagged.length === 0 && (
              <div className="state">
                <IconSearch size={28} />
                <p className="state__hint">No notes tagged {query.trim()}</p>
              </div>
            )}
            {tagged.map((n) => (
              <button key={n.path} className="row" onClick={() => open(n.path)}>
                <span className="row__icon">
                  <IconNote size={20} />
                </span>
                <span className="row__body">
                  <span className="row__title" style={{ display: 'block' }}>
                    {n.title}
                  </span>
                  <span className="hit__path">{n.path}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {!isTagQuery && (
          <div className="rowlist">
            {!query.trim() && quick.length > 0 && (
              <p className="group__label" style={{ padding: '8px 12px 4px' }}>
                Recent & updated
              </p>
            )}
            {quick.map((n) => (
              <button key={n.path} className="row" onClick={() => open(n.path)}>
                <span className="row__icon">
                  <IconNote size={20} />
                </span>
                <span className="row__body">
                  <span className="row__title" style={{ display: 'block' }}>
                    {n.title}
                  </span>
                  <span className="hit__path">{n.path}</span>
                </span>
              </button>
            ))}

            {fullText.length > 0 && (
              <p className="group__label" style={{ padding: '14px 12px 4px' }}>
                In note text
              </p>
            )}
            {fullText.map((h) => (
              <button key={h.path} className="row" onClick={() => open(h.path)}>
                <span className="row__icon">
                  <IconSearch size={18} />
                </span>
                <span className="row__body">
                  <span className="row__title" style={{ display: 'block' }}>
                    {h.title}
                  </span>
                  {h.excerpt && <span className="hit__excerpt">{h.excerpt}</span>}
                </span>
              </button>
            ))}

            {query.trim() && quick.length === 0 && fullText.length === 0 && (
              <div className="state">
                <IconSearch size={28} />
                <p className="state__hint">
                  Nothing matches "{query.trim()}". Try fewer letters — search also looks
                  inside note text.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
