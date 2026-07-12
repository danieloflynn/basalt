import { Tag } from '@lezer/highlight';
import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown';

/**
 * Custom highlight tags for the frontmatter block, so the editor theme
 * (basaltHighlight) can render it dim and monospace — Obsidian's source-mode
 * look — instead of the display face.
 */
export const frontmatterContent = Tag.define();
export const frontmatterMark = Tag.define();

/**
 * A single `---` fence line — EXACTLY three dashes (the `\r?` tolerates a CRLF
 * line ending leaking into `line.text`). Obsidian and the app's own reading
 * view (`src/lib/frontmatter.ts`) do NOT treat `----` (or more) as a fence, so
 * we don't either — that keeps the editor's frontmatter isolation and the
 * reader's property parsing in lockstep.
 */
const OPEN_FENCE = /^---\r?$/;

/**
 * Mirror of `src/lib/frontmatter.ts`'s `FM_PATTERN`: a document-leading block is
 * frontmatter iff it opens with exactly `---` and has a matching closing `---`
 * line later (never on the line immediately after the open — there must be at
 * least one content line). Group 1 is the closing fence, group 2 its terminator,
 * so we can derive the close offset from an anchored (`^`, index 0) match.
 */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n(---)(\r?\n|$)/;

/** Minimal view of the parser's private `Input` — the only multi-line lookahead available. */
interface RawInput {
  read(from: number, to: number): string;
  length: number;
}

/**
 * Recognize a document-leading YAML frontmatter block (`---` … `---`) as its own
 * Lezer node so its contents are NOT markdown-parsed.
 *
 * Without this, a leading `---` + `key: value` + `---` parses as a thematic break
 * followed by a setext H2, so the editor styles the keys as a giant Fraunces
 * heading. Registering an eager block parser *before* HorizontalRule lets it
 * claim the opening `---` and consume through the closing fence, emitting a
 * `Frontmatter` node whose text keeps the editor's default monospace face.
 *
 * CRITICAL: @lezer/markdown's `nextLine()` NEVER rewinds — every line a block
 * parser consumes is committed even if it later returns false. The previous
 * implementation consumed lines hunting for the close and, on an UNCLOSED `---`
 * (exactly what a user has while typing frontmatter top-down), bailed after
 * eating the whole document — collapsing headings, lists and every other block
 * into one empty paragraph, with no highlighting. So we must decide whether a
 * valid closing fence exists BEFORE consuming anything: `peekLine()` only sees
 * one line ahead, so we read the raw document text via the parser's `Input` and
 * locate the close first. Only when it exists do we advance.
 */
export const frontmatter: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true, style: frontmatterContent },
    { name: 'FrontmatterMark', style: frontmatterMark },
  ],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx: BlockContext, line: Line): boolean {
        // Only the very first line of the document can open frontmatter, and it
        // must be exactly `---`. Cheap guard before touching the whole doc.
        if (cx.lineStart !== 0 || !OPEN_FENCE.test(line.text)) return false;

        // Look ahead WITHOUT consuming: read the raw doc and confirm a valid
        // closing fence exists. `input` is private on BlockContext, but reading
        // the source text is the only lookahead the parser exposes past one line.
        const input = (cx as unknown as { input: RawInput }).input;
        const raw = input.read(0, input.length);
        const m = FRONTMATTER.exec(raw);
        if (!m) return false; // no closing fence → not frontmatter; consume nothing

        // Absolute offset of the closing fence (match is anchored at 0).
        const closeStart = m[0].length - m[1].length - m[2].length;

        const marks = [cx.elt('FrontmatterMark', 0, line.text.length)];
        while (cx.nextLine()) {
          if (cx.lineStart >= closeStart) {
            marks.push(cx.elt('FrontmatterMark', cx.lineStart, cx.lineStart + line.text.length));
            break;
          }
        }
        const end = cx.lineStart + line.text.length;
        cx.addElement(cx.elt('Frontmatter', 0, end, marks));
        cx.nextLine(); // step past the closing fence
        return true;
      },
    },
  ],
};
