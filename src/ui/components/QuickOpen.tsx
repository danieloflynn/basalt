import { useEffect, useMemo, useRef, useState } from 'react';
import { useVault, vaultService } from '@/services';
import { openNote } from '@/state/nav';
import { IconNote, IconSearch } from '@/ui/icons';

/** Obsidian's quick switcher: type-ahead over titles, then full text. */
export function QuickOpen({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const indexVersion = useVault((s) => s.indexVersion);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  const quick = useMemo(
    () => vaultService.quickOpen(query),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, indexVersion],
  );
  const fullText = useMemo(() => {
    if (!query.trim()) return [];
    const quickPaths = new Set(quick.map((n) => n.path));
    return vaultService.searchNotes(query, 10).filter((h) => !quickPaths.has(h.path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, quick, indexVersion]);

  const open = (path: string) => {
    onClose();
    openNote(path);
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="quickopen">
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Jump to note…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && quick[0]) open(quick[0].path);
          }}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <div className="quickopen__results">
          {quick.map((n) => (
            <button key={n.path} className="tree-row" onClick={() => open(n.path)}>
              <span className="row__icon">
                <IconNote size={17} />
              </span>
              <span className="tree-row__name">{n.title}</span>
              <span className="hit__path">{n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : ''}</span>
            </button>
          ))}
          {fullText.map((h) => (
            <button key={h.path} className="tree-row" onClick={() => open(h.path)}>
              <span className="row__icon">
                <IconSearch size={16} />
              </span>
              <span className="tree-row__name">{h.title}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
