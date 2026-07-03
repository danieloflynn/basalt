import { create } from 'zustand';
import { noteTitle } from '@/lib/paths';
import { formatDate, useSettings, useVault, vaultService, type NoteMeta } from '@/services';
import { currentScreen, useNav } from '@/state/nav';
import { fillTemplateVars, resolveNewNoteFolder, resolveTemplateFolder } from '@/ui/locations';

/** The configured template folder (settings-driven), never blank. */
export function templateFolder(): string {
  return resolveTemplateFolder(useSettings.getState().settings.templateFolder);
}

/** Markdown notes that live in the configured template folder, title-sorted. */
export function listTemplateNotes(): NoteMeta[] {
  const prefix = `${templateFolder()}/`;
  return [...useVault.getState().notes.values()]
    .filter((n) => n.path.startsWith(prefix))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Folder a note lands in when created without an explicit folder context. */
export function defaultNewNoteFolder(): string {
  const s = useSettings.getState().settings;
  return resolveNewNoteFolder(s.newNoteLocation, s.newNoteFolderPath);
}

/** Read a template and expand its variables for a note titled `title`. */
async function expandTemplate(templatePath: string, title: string): Promise<string> {
  const body = await vaultService.readNote(templatePath);
  const now = new Date();
  return fillTemplateVars(body, {
    title,
    date: formatDate('YYYY-MM-DD', now),
    time: formatDate('HH:mm', now),
  });
}

// ---------------------------------------------------------------------------
// Insert-into-current-note handoff
//
// The editor is owned by another module (EditScreen). Rather than reach into
// its CodeMirror instance, we stash the expanded template text keyed by the
// target note path; EditScreen drains it at the caret via takeTemplateFor().
// ---------------------------------------------------------------------------

interface TemplateHandoff {
  pending: { path: string; text: string } | null;
}

export const useTemplateHandoff = create<TemplateHandoff>(() => ({ pending: null }));

/**
 * Consume the template queued for `path`, if any (clears it). Returns the text
 * to insert at the caret, or null when nothing is pending for this note.
 * Called by EditScreen once its editor view is ready.
 */
export function takeTemplateFor(path: string): string | null {
  const { pending } = useTemplateHandoff.getState();
  if (!pending || pending.path !== path) return null;
  useTemplateHandoff.setState({ pending: null });
  return pending.text;
}

/**
 * "Insert template" command: expand the chosen template and drop it into the
 * current note at the caret. When a note is open in reading view we switch it to
 * the editor first (the handoff survives the remount). With no note open we fall
 * back to creating one in the default location seeded with the template.
 */
export async function insertTemplate(templatePath: string): Promise<void> {
  const screen = currentScreen(useNav.getState());

  if (screen.name === 'note' || screen.name === 'edit') {
    const { path } = screen;
    const text = await expandTemplate(templatePath, noteTitle(path));
    useTemplateHandoff.setState({ pending: { path, text } });
    // Reading view has no editor mounted — switch to it so the handoff lands.
    if (screen.name === 'note') useNav.getState().push({ name: 'edit', path });
    return;
  }

  // Nothing open: create a note in the default location, seeded with the template.
  const path = await vaultService.createNote(defaultNewNoteFolder(), 'Untitled');
  const text = await expandTemplate(templatePath, noteTitle(path));
  await vaultService.writeNote(path, text);
  useNav.getState().push({ name: 'edit', path });
}
