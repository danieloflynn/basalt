import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { history, historyKeymap, redo, undo, defaultKeymap } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { useEffect, useRef, useState } from 'react';
import { noteTitle } from '@/lib/paths';
import { useSettings, useVault, vaultService } from '@/services';
import { useNav } from '@/state/nav';
import { InlineTitle } from '@/ui/components/InlineTitle';
import {
  IconBold,
  IconCode,
  IconDots,
  IconEye,
  IconHeading,
  IconItalic,
  IconList,
  IconRedo,
  IconSearch,
  IconTodo,
  IconUndo,
  IconWikilink,
} from '@/ui/icons';
import { NoteMenu } from '@/ui/components/NoteMenu';
import { SidebarToggle } from '@/ui/workspace/chrome';
import { livePreview } from '@/ui/editor/livePreview';
import { basaltEditorTheme, basaltHighlight } from '@/ui/editor/theme';
import { wikilinkCompletions } from '@/ui/editor/wikilinkComplete';

const AUTOSAVE_MS = 800;

// App.tsx keys screens on `screen.path`, so a self-rename remounts this screen.
// That's harmless here — flushSave clears the dirty flag before the rename and
// skips writing to a path that no longer exists — but the fresh CodeMirror
// instance loses the caret. This survives the remount to restore Obsidian's
// "Enter in the title jumps to the body" behavior.
let pendingFocusBody: string | null = null;

function focusBodyStart(view: EditorView | null): void {
  if (!view) return;
  view.focus();
  view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
}

export function EditScreen({ path }: { path: string }) {
  const nav = useNav();
  const editorFocused = useNav((s) => s.editorFocused);
  const editorMode = useSettings((s) => s.settings.editorMode);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  // Every save targets the *current* path, so a rename can't misfile the buffer.
  const pathRef = useRef(path);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'typing'>('saved');
  const [fresh, setFresh] = useState(false);

  // Persist the buffer to the current path. A stale flush must never recreate a
  // file that was deleted or renamed away (from another tab / self-rename), so
  // skip when the target no longer exists in the vault.
  const flushSave = async (): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const v = viewRef.current;
    if (!v || !dirtyRef.current) return;
    dirtyRef.current = false;
    setSaveState('saved');
    const target = pathRef.current;
    if (!useVault.getState().notes.has(target)) return;
    await vaultService.writeNote(target, v.state.doc.toString());
  };

  useEffect(() => {
    pathRef.current = path;
    let cancelled = false;
    let view: EditorView | null = null;

    void vaultService.readNote(path).then((text) => {
      if (cancelled || !hostRef.current) return;
      view = new EditorView({
        parent: hostRef.current,
        state: EditorState.create({
          doc: text,
          extensions: [
            history(),
            // markdownKeymap first: Enter continues lists, Backspace unwraps.
            keymap.of([...markdownKeymap, ...searchKeymap, ...defaultKeymap, ...historyKeymap]),
            markdown({ base: markdownLanguage }),
            basaltEditorTheme,
            basaltHighlight,
            ...(editorMode === 'live' ? [livePreview()] : []),
            search({ top: true }),
            closeBrackets(),
            autocompletion({ override: [wikilinkCompletions], icons: false }),
            placeholder('Write…'),
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({
              spellcheck: 'true',
              autocapitalize: 'sentences',
              autocorrect: 'on',
            }),
            EditorView.updateListener.of((u) => {
              if (u.focusChanged) {
                useNav.getState().setEditorFocused(u.view.hasFocus);
              }
              if (!u.docChanged) return;
              dirtyRef.current = true;
              setSaveState('typing');
              if (saveTimer.current) clearTimeout(saveTimer.current);
              saveTimer.current = setTimeout(() => void flushSave(), AUTOSAVE_MS);
            }),
          ],
        }),
      });
      viewRef.current = view;
      setLoaded(true);
      // Fresh note (the create → edit flow): empty + still named Untitled.
      if (text.length === 0 && /^Untitled( \d+)?$/.test(noteTitle(path))) setFresh(true);
      // Restore the caret in the body after a rename-triggered remount.
      if (pendingFocusBody === path) {
        pendingFocusBody = null;
        focusBodyStart(view);
      }
    });

    return () => {
      cancelled = true;
      if (view) {
        void flushSave(); // never lose work on navigate-away (E-3)
        view.destroy();
      }
      viewRef.current = null;
      setLoaded(false);
      useNav.getState().setEditorFocused(false);
    };
  }, [path, editorMode]);

  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="screen" style={{ background: 'var(--bg)' }}>
      <header className="workspace-top">
        <SidebarToggle />
        <span className="workspace-top__status">
          {saveState === 'typing' ? 'Editing…' : noteTitle(path)}
        </span>
        <span style={{ flex: 1 }} />
        <div className="workspace-top__group">
          <button
            className="iconbtn"
            aria-label="Undo"
            onClick={() => viewRef.current && undo(viewRef.current)}
          >
            <IconUndo size={20} />
          </button>
          <button
            className="iconbtn"
            aria-label="Redo"
            onClick={() => viewRef.current && redo(viewRef.current)}
          >
            <IconRedo size={20} />
          </button>
          <button
            className="iconbtn iconbtn--accent"
            aria-label="Reading view"
            onClick={() => nav.replace({ name: 'note', path })}
          >
            <IconEye size={20} />
          </button>
          <button className="iconbtn" aria-label="Note menu" onClick={() => setMenuOpen(true)}>
            <IconDots size={20} />
          </button>
        </div>
      </header>

      {/* Pinned above the editor (does not scroll with the document — an
          accepted trade-off vs. threading the title into the CodeMirror doc). */}
      <InlineTitle
        path={path}
        autoFocus={fresh}
        blurOnEnter={false}
        onBeforeCommit={flushSave}
        onCommitted={(finalPath, { renamed, viaEnter }) => {
          pathRef.current = finalPath;
          if (!viaEnter) return;
          // Enter moves focus to the body start (Obsidian). A rename remounts
          // this screen, so hand off via pendingFocusBody; otherwise focus now.
          if (renamed) pendingFocusBody = finalPath;
          else focusBodyStart(viewRef.current);
        }}
      />

      <div ref={hostRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} />
      {!loaded && <div className="state" />}

      {/* Obsidian behavior: the toolbar rides the keyboard, the pill fills in otherwise. */}
      {editorFocused && <Toolbar viewRef={viewRef} />}
      {menuOpen && <NoteMenu path={path} onClose={() => setMenuOpen(false)} />}
    </div>
  );
}

/** Touch formatting bar pinned above the keyboard (E-8). */
function Toolbar({ viewRef }: { viewRef: React.RefObject<EditorView | null> }) {
  const { settings, update } = useSettings();

  const act = (fn: (v: EditorView) => void) => () => {
    const v = viewRef.current;
    if (!v) return;
    fn(v);
    v.focus();
  };

  return (
    <div
      // Keep taps here from blurring the editor (which would hide this bar).
      onPointerDown={(e) => e.preventDefault()}
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
      <button className="iconbtn" aria-label="Find and replace" onClick={act(openSearchPanel)}>
        <IconSearch size={20} />
      </button>
      <button
        className="iconbtn"
        aria-label={settings.editorMode === 'live' ? 'Switch to source mode' : 'Switch to live preview'}
        style={settings.editorMode === 'source' ? { color: 'var(--ember)' } : undefined}
        onClick={() =>
          void update({ editorMode: settings.editorMode === 'live' ? 'source' : 'live' })
        }
      >
        <IconCode size={20} />
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
