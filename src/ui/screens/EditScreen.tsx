import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { history, historyKeymap, redo, undo, defaultKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { useEffect, useRef, useState } from 'react';
import { noteTitle } from '@/lib/paths';
import { vaultService } from '@/services';
import { useNav } from '@/state/nav';
import {
  IconBack,
  IconBold,
  IconEye,
  IconHeading,
  IconItalic,
  IconList,
  IconRedo,
  IconTodo,
  IconUndo,
  IconWikilink,
} from '@/ui/icons';
import { basaltEditorTheme, basaltHighlight } from '@/ui/editor/theme';
import { wikilinkCompletions } from '@/ui/editor/wikilinkComplete';

const AUTOSAVE_MS = 800;

export function EditScreen({ path }: { path: string }) {
  const nav = useNav();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'typing'>('saved');

  useEffect(() => {
    let cancelled = false;
    let view: EditorView | null = null;

    const save = (v: EditorView) => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      setSaveState('saved');
      void vaultService.writeNote(path, v.state.doc.toString());
    };

    void vaultService.readNote(path).then((text) => {
      if (cancelled || !hostRef.current) return;
      view = new EditorView({
        parent: hostRef.current,
        state: EditorState.create({
          doc: text,
          extensions: [
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            markdown({ base: markdownLanguage }),
            basaltEditorTheme,
            basaltHighlight,
            closeBrackets(),
            autocompletion({ override: [wikilinkCompletions], icons: false }),
            placeholder('Write…'),
            EditorView.lineWrapping,
            EditorView.updateListener.of((u) => {
              if (!u.docChanged) return;
              dirtyRef.current = true;
              setSaveState('typing');
              if (saveTimer.current) clearTimeout(saveTimer.current);
              saveTimer.current = setTimeout(() => save(u.view), AUTOSAVE_MS);
            }),
          ],
        }),
      });
      viewRef.current = view;
      setLoaded(true);
    });

    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (view) {
        save(view); // never lose work on navigate-away (E-3)
        view.destroy();
      }
      viewRef.current = null;
    };
  }, [path]);

  const flushAndBack = () => {
    nav.back();
  };

  return (
    <div className="screen" style={{ background: 'var(--bg)' }}>
      <header className="topbar">
        <button className="iconbtn" aria-label="Done editing" onClick={flushAndBack}>
          <IconBack />
        </button>
        <h1 className="topbar__title">
          {noteTitle(path)}
          <span className="topbar__subtitle">{saveState === 'typing' ? 'Editing…' : 'Saved'}</span>
        </h1>
        <button
          className="iconbtn"
          aria-label="Undo"
          onClick={() => viewRef.current && undo(viewRef.current)}
        >
          <IconUndo />
        </button>
        <button
          className="iconbtn"
          aria-label="Redo"
          onClick={() => viewRef.current && redo(viewRef.current)}
        >
          <IconRedo />
        </button>
        <button
          className="iconbtn iconbtn--accent"
          aria-label="Preview"
          onClick={() => nav.replace({ name: 'note', path })}
        >
          <IconEye />
        </button>
      </header>

      <div ref={hostRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} />
      {!loaded && <div className="state" />}

      <Toolbar viewRef={viewRef} />
    </div>
  );
}

/** Touch formatting bar pinned above the keyboard (E-8). */
function Toolbar({ viewRef }: { viewRef: React.RefObject<EditorView | null> }) {
  const act = (fn: (v: EditorView) => void) => () => {
    const v = viewRef.current;
    if (!v) return;
    fn(v);
    v.focus();
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-around',
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
        paddingBottom: 'var(--safe-bottom)',
        flexShrink: 0,
      }}
    >
      <button className="iconbtn" aria-label="Heading" onClick={act(cycleHeading)}>
        <IconHeading size={20} />
      </button>
      <button className="iconbtn" aria-label="Bold" onClick={act((v) => wrapSelection(v, '**'))}>
        <IconBold size={20} />
      </button>
      <button className="iconbtn" aria-label="Italic" onClick={act((v) => wrapSelection(v, '*'))}>
        <IconItalic size={20} />
      </button>
      <button className="iconbtn" aria-label="List" onClick={act((v) => togglePrefix(v, '- '))}>
        <IconList size={20} />
      </button>
      <button
        className="iconbtn"
        aria-label="Task"
        onClick={act((v) => togglePrefix(v, '- [ ] '))}
      >
        <IconTodo size={20} />
      </button>
      <button className="iconbtn" aria-label="Wikilink" onClick={act(insertWikilink)}>
        <IconWikilink size={20} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting commands
// ---------------------------------------------------------------------------

function wrapSelection(view: EditorView, marker: string): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const n = marker.length;
  const before = view.state.sliceDoc(Math.max(0, from - n), from);
  const after = view.state.sliceDoc(to, to + n);

  if (before === marker && after === marker) {
    view.dispatch({
      changes: [
        { from: from - n, to: from, insert: '' },
        { from: to, to: to + n, insert: '' },
      ],
      selection: { anchor: from - n, head: to - n },
    });
    return;
  }
  view.dispatch({
    changes: { from, to, insert: `${marker}${selected}${marker}` },
    selection: selected
      ? { anchor: from + n, head: to + n }
      : { anchor: from + n },
  });
}

function lineRange(view: EditorView) {
  const { from } = view.state.selection.main;
  return view.state.doc.lineAt(from);
}

function cycleHeading(view: EditorView): void {
  const line = lineRange(view);
  const m = /^(#{1,6})\s/.exec(line.text);
  let next: string;
  if (!m) next = `# ${line.text}`;
  else if (m[1].length >= 3) next = line.text.replace(/^#{1,6}\s/, '');
  else next = `#${line.text}`;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: next },
    selection: { anchor: line.from + next.length },
  });
}

function togglePrefix(view: EditorView, prefix: string): void {
  const line = lineRange(view);
  const has = line.text.startsWith(prefix);
  const next = has ? line.text.slice(prefix.length) : `${prefix}${line.text}`;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: next },
    selection: { anchor: line.from + next.length },
  });
}

function insertWikilink(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `[[${selected}]]` },
    selection: { anchor: from + 2 + selected.length },
  });
}
