/**
 * Word/character counts for the desktop status bar — shared by the reader
 * (rendered body) and the editor (CodeMirror doc, via the same content cache).
 * Always operates on the note BODY (frontmatter already stripped by the
 * caller via parseFrontmatter) so property keys/values never inflate a note's
 * counts.
 */

/** Whitespace-split token count. Empty/whitespace-only body counts as 0. */
export function countWords(body: string): number {
  const trimmed = body.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** Raw character length of the body. */
export function countChars(body: string): number {
  return body.length;
}
