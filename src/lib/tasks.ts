/**
 * Task-list (checkbox) helpers shared by the reading view and the live-preview
 * editor. Pure text → text; callers own persistence and cursor mapping.
 */

/** A task item line: list marker + `[ ]`/`[x]` box (not `- [x](link)` text). */
const TASK_RE = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\](?:[ \t]|$)/;
/** Any list item line (bullet, numbered, or task). */
const LIST_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/;
/** A thematic break (`---`, `- - -`, `* * *`, `___`) — the -/* spellings also match LIST_RE. */
const THEMATIC_RE = /^[ \t]*([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
/** Blocks that interrupt a paragraph (so a line of them is never a lazy continuation). */
const INTERRUPT_RE = /^ {0,3}(?:#{1,6}[ \t]|>|```|~~~|<[a-zA-Z!?/])/;

/** Flip "- [ ]" <-> "- [x]" on the given 1-based line of the full note text. */
export function toggleTaskAtLine(text: string, line: number): string | null {
  const lines = text.split('\n');
  const i = line - 1;
  if (i < 0 || i >= lines.length) return null;
  const current = lines[i];
  const toggled = current.replace(
    /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/,
    (_, pre: string, mark: string, post: string) =>
      `${pre}${mark === ' ' ? 'x' : ' '}${post}`,
  );
  if (toggled === current) return null;
  lines[i] = toggled;
  return lines.join('\n');
}

export interface TaskSortRegion {
  /** 1-based inclusive line range of the sibling group that was rearranged. */
  startLine: number;
  endLine: number;
  /** Replacement lines for that range. */
  lines: string[];
}

/** Splice a sort region back into the full text. */
export function applyTaskSort(text: string, region: TaskSortRegion): string {
  const lines = text.split('\n');
  lines.splice(region.startLine - 1, region.endLine - region.startLine + 1, ...region.lines);
  return lines.join('\n');
}

/** Indent width for level comparison (tab counts as 4). */
function indentWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch === '\t' ? 4 : 1;
  return w;
}

/**
 * After the task at `line` (1-based) was toggled, sink it if now checked —
 * below every sibling in its list group — or float it if now unchecked — back
 * above the group's checked run. Siblings are the contiguous list items at the
 * item's own indent (each moving with its more-indented subtree); one blank
 * line between items (a loose list) stays in the group, two or more end it.
 * Returns the rearranged line region, or null when nothing needs to move.
 */
export function sortToggledTask(text: string, line: number): TaskSortRegion | null {
  const lines = text.split('\n');
  const idx = line - 1;
  if (idx < 0 || idx >= lines.length) return null;
  const m = TASK_RE.exec(lines[idx]);
  if (!m) return null;
  const indent = indentWidth(m[1]);
  const checked = m[2] !== ' ';

  const isBlank = (i: number): boolean => lines[i].trim() === '';
  const wOf = (i: number): number => indentWidth(/^[ \t]*/.exec(lines[i])![0]);
  const isItem = (i: number): boolean =>
    !isBlank(i) && LIST_RE.test(lines[i]) && !THEMATIC_RE.test(lines[i]);
  const isSibling = (i: number): boolean => isItem(i) && wOf(i) === indent;

  // Last line of the block starting at a sibling item line. A block owns its
  // deeper-indented content (blanks before it stay interior) plus CommonMark
  // lazy continuations — adjacent non-list plain lines at any indent. A blank
  // followed by non-indented content, any same-or-shallower list item, a
  // thematic break, or a paragraph-interrupting block ends it.
  const blockEnd = (start: number): number => {
    let end = start;
    let afterBlank = false;
    for (let j = start + 1; j < lines.length; j++) {
      if (isBlank(j)) {
        afterBlank = true;
        continue;
      }
      if (wOf(j) > indent) {
        end = j;
        afterBlank = false;
        continue;
      }
      if (afterBlank || LIST_RE.test(lines[j]) || THEMATIC_RE.test(lines[j])) break;
      if (INTERRUPT_RE.test(lines[j])) break;
      end = j; // lazy continuation line
      afterBlank = false;
    }
    return end;
  };

  // Walk up to the first item of the group. From each candidate line, find the
  // nearest item line at our indent-or-shallower above it and accept it only
  // when it is a sibling whose block really spans down to the candidate —
  // blockEnd is the single source of truth, so paragraphs, thematic breaks,
  // and over-deep gaps all reject naturally.
  let groupStart = idx;
  for (let i = idx - 1; i >= 0; ) {
    let k = i;
    let blanks = 0;
    while (k >= 0 && isBlank(k)) {
      blanks++;
      k--;
    }
    if (k < 0 || blanks > 1) break;
    let s = k;
    while (s >= 0 && !(isItem(s) && wOf(s) <= indent)) s--;
    if (s < 0 || !isSibling(s) || blockEnd(s) < k) break;
    groupStart = s;
    i = s - 1;
  }

  // Collect the group's blocks downward, remembering each gap (0 or 1 blank)
  // so untouched neighbors keep their exact original spacing.
  interface Block {
    start: number;
    end: number;
    task: boolean;
    checked: boolean;
    gapAfter: number;
  }
  const blocks: Block[] = [];
  for (let p = groupStart; p < lines.length && isSibling(p); ) {
    const end = blockEnd(p);
    const tm = TASK_RE.exec(lines[p]);
    const block: Block = {
      start: p,
      end,
      task: tm !== null,
      checked: tm !== null && tm[2] !== ' ',
      gapAfter: 0,
    };
    blocks.push(block);
    let q = end + 1;
    let blanks = 0;
    while (q < lines.length && isBlank(q)) {
      blanks++;
      q++;
    }
    if (blanks > 1 || q >= lines.length || !isSibling(q)) break;
    block.gapAfter = blanks;
    p = q;
  }

  const ti = blocks.findIndex((b) => b.start === idx);
  if (ti === -1 || blocks.length < 2) return null;

  const moved = blocks[ti];
  const rest = blocks.filter((_, i) => i !== ti);
  let insertAt: number;
  if (checked) {
    insertAt = rest.length; // sink to the bottom of the group
  } else {
    const firstChecked = rest.findIndex((b) => b.task && b.checked);
    insertAt = firstChecked === -1 ? ti : firstChecked; // above the checked run
  }
  const order = [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)];
  // Nothing moved: stop before reassembly/renumbering so a no-op tap can
  // never rewrite untouched lines (e.g. normalizing non-contiguous ordinals).
  if (order.every((b, i) => b === blocks[i])) return null;

  // Reassemble: pairs that were already adjacent keep their original gap;
  // only the new adjacencies created by the move get a synthesized one.
  const anyLoose = blocks.some((b) => b.gapAfter > 0);
  const origIndex = new Map<Block, number>(blocks.map((b, i) => [b, i]));
  const out: string[] = [];
  order.forEach((b, i) => {
    if (i > 0) {
      const prev = order[i - 1];
      const adjacent = origIndex.get(prev)! + 1 === origIndex.get(b)!;
      if (adjacent ? prev.gapAfter > 0 : anyLoose) out.push('');
    }
    for (let l = b.start; l <= b.end; l++) out.push(lines[l]);
  });

  // Contiguous numbered runs would end up misnumbered after the move; keep
  // ordinals sequential (from the group's original start number) when every
  // item in the group is numbered.
  if (blocks.every((b) => /^[ \t]*\d+[.)]/.test(lines[b.start]))) {
    let ord = Number(/^[ \t]*(\d+)/.exec(lines[blocks[0].start])![1]) - 1;
    for (let i = 0; i < out.length; i++) {
      const im = /^([ \t]*)\d+([.)])([ \t])/.exec(out[i]);
      if (im && indentWidth(im[1]) === indent) {
        out[i] = out[i].replace(/^([ \t]*)\d+([.)])/, `$1${++ord}$2`);
      }
    }
  }

  const startLine = blocks[0].start + 1;
  const endLine = blocks[blocks.length - 1].end + 1;
  const before = lines.slice(startLine - 1, endLine);
  if (out.length === before.length && out.every((l, i) => l === before[i])) return null;
  return { startLine, endLine, lines: out };
}
