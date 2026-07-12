import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { search, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { useEffect, useRef, useState } from 'react';
import { registerEditorFlush } from '@/lib/editorFlush';
import { showSoftKeyboard } from '@/lib/keyboard';
import { slugifyHeading } from '@/lib/outline';
import { noteTitle } from '@/lib/paths';
import { useSettings, useVault, vaultService } from '@/services';
import { currentScreen, useNav } from '@/state/nav';
import { takeTemplateFor, useTemplateHandoff } from '@/ui/templates';
import { InlineTitle } from '@/ui/components/InlineTitle';
import { IconDots, IconEye } from '@/ui/icons';
import { NoteMenu } from '@/ui/components/NoteMenu';
import { PaneHeader } from '@/ui/workspace/PaneHeader';
import { SidebarToggle } from '@/ui/workspace/chrome';
import { EditorToolbar } from '@/ui/editor/EditorToolbar';
import { frontmatter } from '@/ui/editor/frontmatter';
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
  showSoftKeyboard();
}

/**
 * Put the caret on the heading a [[Note#Section]] link points at and scroll it
 * into view. Uses the same match the reading view uses (`^#{1,6}\s+` + a
 * slug/text comparison via slugifyHeading), so tapping a heading link lands in
 * the same place whether the note opens to read or to edit. Doesn't steal focus
 * (no soft keyboard) — it's a navigation, not an edit.
 */
function scrollToHeadingLine(view: EditorView, heading: string): void {
  const target = slugifyHeading(heading);
  const { doc } = view.state;
  for (let i = 1; i <= doc.lines; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(doc.line(i).text);
    if (m && slugifyHeading(m[2]) === target) {
      view.dispatch({ selection: { anchor: doc.line(i).from }, scrollIntoView: true });
      return;
    }
  }
}

export function EditScreen({ path }: { path: string }) {
  const nav = useNav();
  const editorFocused = useNav((s) => s.editorFocused);
  // App keys EditScreen on screen.path (not the heading), so read the heading
  // anchor straight from nav — a [[Note#Section]] tap that reroutes to the
  // editor carries it here (App can't forward it as a prop).
  const heading = useNav((s) => {
    const scr = currentScreen(s);
    return scr.name === 'edit' && scr.path === path ? scr.heading : undefined;
  });
  const editorMode = useSettings((s) => s.settings.editorMode);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  // Bumped on every doc change; lets a flush tell whether more was typed while
  // its write was in flight (so it doesn't mark those newer edits "saved").
  const dirtySeqRef = useRef(0);
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
    const target = pathRef.current;
    // A stale flush must not recreate a file renamed/deleted away — drop it clean.
    if (!useVault.getState().notes.has(target)) {
      dirtyRef.current = false;
      setSaveState('saved');
      return;
    }
    const seq = dirtySeqRef.current;
    const text = v.state.doc.toString();
    try {
      await vaultService.writeNote(target, text);
    } catch {
      // The write failed (fs/git error): the buffer is NOT saved, so keep it
      // dirty and retry. Clearing the flag here would silently discard the note.
      dirtyRef.current = true;
      setSaveState('typing');
      if (!saveTimer.current) saveTimer.current = setTimeout(() => void flushSave(), AUTOSAVE_MS);
      return;
    }
    // Only mark clean if nothing was typed while the write was in flight;
    // otherwise a follow-up flush will persist the newer edits.
    if (dirtySeqRef.current === seq) {
      dirtyRef.current = false;
      setSaveState('saved');
    } else if (!saveTimer.current) {
      saveTimer.current = setTimeout(() => void flushSave(), AUTOSAVE_MS);
    }
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
            // markdownKeymap first: Enter continues lists, Backspace unwraps. Then
            // closeBracketsKeymap so Backspace inside an inserted pair ([[|]], [|])
            // clears both sides before defaultKeymap's plain char-delete.
            keymap.of([
              ...markdownKeymap,
              ...closeBracketsKeymap,
              ...searchKeymap,
              ...defaultKeymap,
              ...historyKeymap,
            ]),
            markdown({ base: markdownLanguage, extensions: [frontmatter] }),
            basaltEditorTheme,
            basaltHighlight,
            ...(editorMode === 'live'
              ? [
                  livePreview({
                    sortOnToggle: () => useSettings.getState().settings.sortCheckedToBottom,
                  }),
                ]
              : []),
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
              dirtySeqRef.current++;
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

  // Drain the "Insert template" palette command's handoff into the open editor
  // at the caret — both a template queued before this note opened and one
  // inserted while already editing.
  useEffect(() => {
    if (!loaded) return;
    const drop = () => {
      const v = viewRef.current;
      const text = takeTemplateFor(pathRef.current);
      if (v && text != null) {
        v.dispatch(v.state.replaceSelection(text));
        v.focus();
      }
    };
    drop(); // template queued before this note opened
    return useTemplateHandoff.subscribe(drop); // template inserted while already editing
  }, [path, loaded]);

  // Expose the latest flushSave so external structural ops (rename/move/delete
  // via menus, sheets, tree DnD) flush the buffer to disk before they run —
  // otherwise they read stale text and drop the last ~800ms of typing. The ref
  // keeps the registration stable while always calling the current closure.
  const flushRef = useRef(flushSave);
  useEffect(() => {
    flushRef.current = flushSave;
  });
  useEffect(() => registerEditorFlush(() => flushRef.current()), []);

  // A [[Note#Section]] tap that reroutes to the editor lands the caret on the
  // heading (after the doc loads), matching the reading view's anchor scroll.
  useEffect(() => {
    if (!loaded || !heading) return;
    const v = viewRef.current;
    if (v) scrollToHeadingLine(v, heading);
  }, [heading, loaded]);

  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="screen" style={{ background: 'var(--bg)' }}>
      {nav.desktop ? (
        <PaneHeader path={path} mode="editing" onOpenMenu={() => setMenuOpen(true)} />
      ) : (
        <header className="workspace-top">
          <SidebarToggle />
          <span className="workspace-top__status">
            {saveState === 'typing' ? 'Editing…' : noteTitle(path)}
          </span>
          <span style={{ flex: 1 }} />
          <div className="workspace-top__group">
            <button
              className="iconbtn iconbtn--accent"
              aria-label="Reading view"
              onClick={() => {
                // Sticky: flip the global default so every note opens to read.
                nav.setViewMode('reading');
                void useSettings.getState().update({ defaultView: 'reading' });
                nav.replace({ name: 'note', path });
              }}
            >
              <IconEye size={20} />
            </button>
            <button className="iconbtn" aria-label="Note menu" onClick={() => setMenuOpen(true)}>
              <IconDots size={20} />
            </button>
          </div>
        </header>
      )}

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
      {editorFocused && <EditorToolbar viewRef={viewRef} />}
      {menuOpen && <NoteMenu path={path} onClose={() => setMenuOpen(false)} />}
    </div>
  );
}

