import { useEffect, useMemo, useRef, useState } from 'react';
import { joinPath, stripExt } from '@/lib/paths';
import { useVault, vaultService } from '@/services';
import { openNote, useNav } from '@/state/nav';
import { defaultNewNoteFolder } from '@/ui/templates';
import { IconNote, IconPlus, IconSearch } from '@/ui/icons';

/** Obsidian's quick switcher: type-ahead over titles, then full text. */
export function QuickOpen({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const indexVersion = useVault((s) => s.indexVersion);
  const notes = useVault((s) => s.notes);

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

  // Obsidian: create from the switcher when no note matches the query exactly.
  // A '/' in the query is a folder separator, so "Projects/Idea" creates there.
  const createTarget = useMemo(() => {
    const cleaned = query.trim().replace(/\.md$/i, '');
    const slash = cleaned.lastIndexOf('/');
    const folder = slash === -1 ? '' : cleaned.slice(0, slash).trim();
    const name = cleaned.slice(slash + 1).trim();
    if (!name) return null;
    const full = joinPath(folder, name).toLowerCase();
    for (const n of notes.values()) {
      if (n.title.toLowerCase() === full || stripExt(n.path).toLowerCase() === full) return null;
    }
    return { folder, name, label: joinPath(folder, name) };
  }, [query, notes]);

  const open = (path: string) => {
    onClose();
    openNote(path);
  };

  const create = async () => {
    if (!createTarget) return;
    onClose(); // overlay gone before the write, matching open()
    // A folder typed into the query wins; otherwise fall back to the default
    // new-note location (feature: "New file location should be an option").
    const folder = createTarget.folder || defaultNewNoteFolder();
    const path = await vaultService.createNote(folder, createTarget.name);
    useNav.getState().push({ name: 'edit', path });
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
            if (e.key !== 'Enter') return;
            const noMatches = quick.length === 0 && fullText.length === 0;
            if (createTarget && (e.shiftKey || noMatches)) void create();
            else if (quick[0]) open(quick[0].path);
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
          {createTarget && (
            <button className="tree-row" onClick={() => void create()}>
              <span className="row__icon">
                <IconPlus size={17} />
              </span>
              <span className="tree-row__name">{`Create "${createTarget.label}"`}</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
