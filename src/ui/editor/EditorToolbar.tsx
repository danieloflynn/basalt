import { indentLess, indentMore, redo, undo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { useRef } from 'react';
import { showSoftKeyboard } from '@/lib/keyboard';
import { basename } from '@/lib/paths';
import { useSettings, vaultService } from '@/services';
import {
  IconAttach,
  IconBold,
  IconCode,
  IconEmbed,
  IconHash,
  IconHeading,
  IconHighlight,
  IconIndent,
  IconItalic,
  IconLink,
  IconList,
  IconListNumbered,
  IconOutdent,
  IconQuote,
  IconRedo,
  IconSearch,
  IconStrike,
  IconTodo,
  IconUndo,
  IconWikilink,
} from '@/ui/icons';

/**
 * Obsidian-mobile editing toolbar (E-8): a horizontally scrollable pill of
 * formatting actions, pinned above the keyboard. Renders only while the editor
 * has focus (mounted by EditScreen behind `nav.editorFocused`).
 */
export function EditorToolbar({ viewRef }: { viewRef: React.RefObject<EditorView | null> }) {
  const { settings, update } = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);

  const act = (fn: (v: EditorView) => void) => () => {
    const v = viewRef.current;
    if (!v) return;
    fn(v);
    v.focus();
  };

  // The picked file rides through vaultService.saveAttachment, then an embed is
  // inserted at the caret. Focus is best-effort after the native picker closes.
  const onAttachmentPicked = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be picked again later
    const v = viewRef.current;
    if (!file || !v) return;
    const base64 = await readAsBase64(file);
    const folder = await vaultService.attachmentFolder();
    const saved = await vaultService.saveAttachment(folder, file.name, base64);
    const { from, to } = v.state.selection.main;
    const insert = `![[${basename(saved)}]]`;
    v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
    v.focus();
    showSoftKeyboard();
  };

  return (
    <div className="editor-toolbar-wrap">
      <div
        className="editor-toolbar"
        // Keep taps here from blurring the editor (which would hide this bar).
        onPointerDown={(e) => e.preventDefault()}
      >
        <button className="iconbtn" aria-label="Undo" onClick={act((v) => undo(v))}>
          <IconUndo size={20} />
        </button>
        <button className="iconbtn" aria-label="Redo" onClick={act((v) => redo(v))}>
          <IconRedo size={20} />
        </button>
        <button className="iconbtn" aria-label="Wikilink" onClick={act(insertWikilink)}>
          <IconWikilink size={20} />
        </button>
        <button className="iconbtn" aria-label="Embed" onClick={act(insertEmbed)}>
          <IconEmbed size={20} />
        </button>
        <button className="iconbtn" aria-label="Tag" onClick={act(insertTag)}>
          <IconHash size={20} />
        </button>
        <button
          className="iconbtn"
          aria-label="Attach file"
          onClick={() => fileRef.current?.click()}
        >
          <IconAttach size={20} />
        </button>
        <button className="iconbtn" aria-label="Heading" onClick={act(cycleHeading)}>
          <IconHeading size={20} />
        </button>
        <button className="iconbtn" aria-label="Bold" onClick={act((v) => wrapSelection(v, '**'))}>
          <IconBold size={20} />
        </button>
        <button className="iconbtn" aria-label="Italic" onClick={act((v) => wrapSelection(v, '*'))}>
          <IconItalic size={20} />
        </button>
        <button
          className="iconbtn"
          aria-label="Strikethrough"
          onClick={act((v) => wrapSelection(v, '~~'))}
        >
          <IconStrike size={20} />
        </button>
        <button
          className="iconbtn"
          aria-label="Highlight"
          onClick={act((v) => wrapSelection(v, '=='))}
        >
          <IconHighlight size={20} />
        </button>
        <button
          className="iconbtn"
          aria-label="Inline code"
          onClick={act((v) => wrapSelection(v, '`'))}
        >
          <IconCode size={20} />
        </button>
        <button className="iconbtn" aria-label="Quote" onClick={act((v) => togglePrefix(v, '> '))}>
          <IconQuote size={20} />
        </button>
        <button className="iconbtn" aria-label="Link" onClick={act(insertMarkdownLink)}>
          <IconLink size={20} />
        </button>
        <button className="iconbtn" aria-label="List" onClick={act((v) => togglePrefix(v, '- '))}>
          <IconList size={20} />
        </button>
        <button
          className="iconbtn"
          aria-label="Numbered list"
          onClick={act((v) => togglePrefix(v, '1. '))}
        >
          <IconListNumbered size={20} />
        </button>
        <button
          className="iconbtn"
          aria-label="Task"
          onClick={act((v) => togglePrefix(v, '- [ ] '))}
        >
          <IconTodo size={20} />
        </button>
        <button className="iconbtn" aria-label="Indent" onClick={act((v) => indentMore(v))}>
          <IconIndent size={20} />
        </button>
        <button className="iconbtn" aria-label="Outdent" onClick={act((v) => indentLess(v))}>
          <IconOutdent size={20} />
        </button>

        {/* Basalt extras (Obsidian's config wrench has no analogue here). */}
        <span className="editor-toolbar__sep" />
        <button className="iconbtn" aria-label="Find and replace" onClick={act(openSearchPanel)}>
          <IconSearch size={20} />
        </button>
        <button
          className="iconbtn"
          aria-label={
            settings.editorMode === 'live' ? 'Switch to source mode' : 'Switch to live preview'
          }
          style={settings.editorMode === 'source' ? { color: 'var(--ember)' } : undefined}
          onClick={() =>
            void update({ editorMode: settings.editorMode === 'live' ? 'source' : 'live' })
          }
        >
          <IconCode size={20} />
        </button>
      </div>
      <input ref={fileRef} type="file" hidden onChange={onAttachmentPicked} />
    </div>
  );
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // readAsDataURL yields `data:<mime>;base64,<data>`; writeBinary wants raw base64.
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
    selection: selected ? { anchor: from + n, head: to + n } : { anchor: from + n },
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

function insertEmbed(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `![[${selected}]]` },
    selection: { anchor: from + 3 + selected.length },
  });
}

function insertTag(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: '#' }, selection: { anchor: from + 1 } });
}

/** `[text](url)` around the selection, caret over the `url` placeholder. */
function insertMarkdownLink(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const insert = `[${selected}](url)`;
  const urlStart = from + selected.length + 3; // after '[' + text + ']('
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: urlStart, head: urlStart + 3 },
  });
}
