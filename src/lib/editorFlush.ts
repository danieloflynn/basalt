/**
 * Registry for the active editor's pending-save flush.
 *
 * Structural vault operations started from OUTSIDE the editor (rename/move/
 * delete via menus, sheets, tree drag-and-drop) must flush the open buffer
 * first: otherwise the link rewrite reads stale on-disk text, and the editor's
 * own post-remount flush targets a path that no longer exists — silently
 * dropping the last ~800ms of typing. EditScreen registers its flushSave here;
 * every UI mutation entry point awaits flushActiveEditor() before calling
 * vaultService.
 */
// A Set, not a single slot: the desktop split pane can mount a second editor
// beside the main one, and a structural op must flush EVERY open buffer (an
// extra flush of a clean buffer is a no-op, a missed one loses typing).
const flushes = new Set<() => Promise<void>>();

/** Register a mounted editor's flush; returns an unregister function. */
export function registerEditorFlush(flush: () => Promise<void>): () => void {
  flushes.add(flush);
  return () => {
    flushes.delete(flush);
  };
}

/** Flush every mounted editor's buffer to disk. */
export async function flushActiveEditor(): Promise<void> {
  await Promise.all([...flushes].map((f) => f()));
}
