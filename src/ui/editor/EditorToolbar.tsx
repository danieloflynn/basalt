import { indentLess, indentMore, redo, undo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import type { Line } from '@codemirror/state';
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

  // Like `act`, but does NOT refocus the document afterwards — for commands that
  // move focus elsewhere on purpose (e.g. the find panel's search input).
  const actKeepFocus = (fn: (v: EditorView) => void) => () => {
    const v = viewRef.current;
    if (v) fn(v);
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
        <button className="iconbtn" aria-label="Quote" onClick={act(toggleQuote)}>
          <IconQuote size={20} />
        </button>
        <button className="iconbtn" aria-label="Link" onClick={act(insertMarkdownLink)}>
          <IconLink size={20} />
        </button>
        <button
          className="iconbtn"
          aria-label="List"
          onClick={act((v) => toggleListFamily(v, 'bullet'))}
        >
          <IconList size={20} />
        </button>
        <button
          className="iconbtn"
          aria-label="Numbered list"
          onClick={act((v) => toggleListFamily(v, 'numbered'))}
        >
          <IconListNumbered size={20} />
        </button>
        <button
          className="iconbtn"
          aria-label="Task"
          onClick={act((v) => toggleListFamily(v, 'task'))}
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
        <button
          className="iconbtn"
          aria-label="Find and replace"
          onClick={actKeepFocus(openSearchPanel)}
        >
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

export function wrapSelection(view: EditorView, marker: string): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const n = marker.length;
  const markerChar = marker[0];
  const before = view.state.sliceDoc(Math.max(0, from - n), from);
  const after = view.state.sliceDoc(to, to + n);

  // Unwrap ONLY when the run of marker characters on each side is EXACTLY the
  // marker — not part of a longer run. Otherwise italic (`*`) next to bold
  // (`**`) would strip one `*` off each side and destroy the bold. Requiring an
  // exact run lets shared-character markers compose instead: **text** + italic
  // → ***text*** (the `**` is a 2-run, ≠ the 1-char italic marker, so we wrap).
  const beforeExact =
    before === marker && view.state.sliceDoc(Math.max(0, from - n - 1), from - n) !== markerChar;
  const afterExact = after === marker && view.state.sliceDoc(to + n, to + n + 1) !== markerChar;

  if (beforeExact && afterExact) {
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

export function cycleHeading(view: EditorView): void {
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

// ---------------------------------------------------------------------------
// List / quote toggles — family-aware (Obsidian behaviour) and multi-line.
// ---------------------------------------------------------------------------

type LineKind = 'plain' | 'bullet' | 'numbered' | 'task';
export type ListFamily = 'bullet' | 'numbered' | 'task';

interface ParsedLine {
  indent: string;
  kind: LineKind;
  /** Task checkbox state (only meaningful when kind === 'task'). */
  checked: boolean;
  /** Text after the list marker (or the whole line, minus indent, when plain). */
  content: string;
}

/** Classify a line as bullet / numbered / task / plain, splitting off the marker. */
export function parseListLine(text: string): ParsedLine {
  let m: RegExpExecArray | null;
  // Task first (a task is also a bullet). Allow `- [ ]` at EOL (no trailing text).
  if ((m = /^([ \t]*)[-*+][ \t]+\[([ xX])\][ \t]*(.*)$/.exec(text))) {
    return { indent: m[1], kind: 'task', checked: m[2] !== ' ', content: m[3] };
  }
  if ((m = /^([ \t]*)[-*+][ \t]+(.*)$/.exec(text))) {
    return { indent: m[1], kind: 'bullet', checked: false, content: m[2] };
  }
  if ((m = /^([ \t]*)\d+[.)][ \t]+(.*)$/.exec(text))) {
    return { indent: m[1], kind: 'numbered', checked: false, content: m[2] };
  }
  m = /^([ \t]*)(.*)$/.exec(text) as RegExpExecArray;
  return { indent: m[1], kind: 'plain', checked: false, content: m[2] };
}

/** Render a parsed line as the target family (ordinal only used for numbered). */
function renderLine(p: ParsedLine, target: LineKind, ordinal: number): string {
  switch (target) {
    case 'bullet':
      return `${p.indent}- ${p.content}`;
    case 'task':
      return `${p.indent}- [${p.checked ? 'x' : ' '}] ${p.content}`;
    case 'numbered':
      return `${p.indent}${ordinal}. ${p.content}`;
    case 'plain':
      return `${p.indent}${p.content}`;
  }
}

/**
 * Toggle a list family over every selected line (Obsidian behaviour):
 *  - if EVERY non-blank selected line is already the target family → toggle it
 *    off (back to plain);
 *  - otherwise convert each line TO the target, cleanly replacing whatever
 *    marker it had (numbered ⇄ bullet ⇄ task; task ⇄ bullet swaps the `[ ]`);
 *  - numbered lists are resequenced across the whole contiguous ordered run we
 *    touch, so numbers stay 1..n.
 */
export function toggleListFamily(view: EditorView, target: ListFamily): void {
  const { doc } = view.state;
  const range = view.state.selection.main;
  const firstNum = doc.lineAt(range.from).number;
  const lastNum = doc.lineAt(range.to).number;

  const selected: Line[] = [];
  for (let n = firstNum; n <= lastNum; n++) selected.push(doc.line(n));
  const nonBlank = selected.filter((l) => l.text.trim() !== '');
  const turnOff = nonBlank.length > 0 && nonBlank.every((l) => parseListLine(l.text).kind === target);

  const changes: { from: number; to: number; insert: string }[] = [];
  const replace = (line: Line, text: string) => {
    if (text !== line.text) changes.push({ from: line.from, to: line.to, insert: text });
  };

  if (target === 'numbered' && !turnOff) {
    // Extend through adjacent already-numbered lines above/below the selection
    // and resequence the whole run so the ordinals stay contiguous.
    let startNum = firstNum;
    while (startNum > 1 && parseListLine(doc.line(startNum - 1).text).kind === 'numbered') startNum--;
    let endNum = lastNum;
    while (endNum < doc.lines && parseListLine(doc.line(endNum + 1).text).kind === 'numbered') endNum++;
    let ordinal = 1;
    for (let n = startNum; n <= endNum; n++) {
      const line = doc.line(n);
      const inSelection = n >= firstNum && n <= lastNum;
      if (line.text.trim() === '') {
        if (inSelection && selected.length === 1) replace(line, `${ordinal++}. `);
        continue;
      }
      const p = parseListLine(line.text);
      if (inSelection || p.kind === 'numbered') replace(line, renderLine(p, 'numbered', ordinal++));
    }
  } else {
    for (const line of selected) {
      if (line.text.trim() === '') {
        // Seed a marker on a lone empty line so a fresh list can be started.
        if (!turnOff && selected.length === 1) {
          replace(line, renderLine({ indent: '', kind: 'plain', checked: false, content: '' }, target, 1));
        }
        continue;
      }
      const p = parseListLine(line.text);
      replace(line, renderLine(p, turnOff ? 'plain' : target, 1));
    }
  }

  if (changes.length > 0) view.dispatch({ changes });
}

/** Toggle a `> ` blockquote prefix over every selected line. */
export function toggleQuote(view: EditorView): void {
  const { doc } = view.state;
  const range = view.state.selection.main;
  const firstNum = doc.lineAt(range.from).number;
  const lastNum = doc.lineAt(range.to).number;

  const lines: Line[] = [];
  for (let n = firstNum; n <= lastNum; n++) lines.push(doc.line(n));
  const nonBlank = lines.filter((l) => l.text.trim() !== '');
  const turnOff = nonBlank.length > 0 && nonBlank.every((l) => /^\s*>\s?/.test(l.text));

  const changes: { from: number; to: number; insert: string }[] = [];
  for (const line of lines) {
    if (turnOff) {
      const m = /^(\s*)>\s?/.exec(line.text);
      if (m) changes.push({ from: line.from, to: line.from + m[0].length, insert: m[1] });
    } else if (line.text.trim() !== '' || lines.length === 1) {
      changes.push({ from: line.from, to: line.from, insert: '> ' });
    }
  }
  if (changes.length > 0) view.dispatch({ changes });
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

export function insertTag(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  // With a selection, PREFIX it into a tag (`foo` → `#foo`) rather than
  // replacing it with a bare `#`.
  const insert = `#${selected}`;
  view.dispatch({
    changes: { from, to, insert },
    selection: selected ? { anchor: from, head: from + insert.length } : { anchor: from + 1 },
  });
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
