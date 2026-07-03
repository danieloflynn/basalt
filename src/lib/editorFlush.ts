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
let activeFlush: (() => Promise<void>) | null = null;

/** Register the mounted editor's flush; returns an unregister function. */
export function registerEditorFlush(flush: () => Promise<void>): () => void {
  activeFlush = flush;
  return () => {
    if (activeFlush === flush) activeFlush = null;
  };
}

/** Flush the active editor's buffer to disk, if an editor is mounted. */
export async function flushActiveEditor(): Promise<void> {
  if (activeFlush) await activeFlush();
}
