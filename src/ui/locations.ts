/**
 * Pure resolution helpers for template + new-note folder settings and template
 * variable substitution. Kept free of app/service imports so the logic stays
 * unit-testable in isolation (see locations.test.ts). The impure glue that
 * reads the stores lives in templates.ts / newNote consumers.
 */

export interface TemplateVars {
  /** Note title (already resolved from the target path). */
  title: string;
  /** Pre-formatted date, using the app's date convention (YYYY-MM-DD). */
  date: string;
  /** Pre-formatted time, using the app's clock convention (HH:mm). */
  time: string;
}

/**
 * Substitute `{{title}}`, `{{date}}`, `{{time}}` (case-insensitive, tolerant of
 * inner whitespace) — the same variable syntax the vault's daily-note templates
 * use. Date/time are passed in already formatted so the caller controls the
 * clock convention.
 */
export function fillTemplateVars(body: string, vars: TemplateVars): string {
  return body
    .replace(/{{\s*title\s*}}/gi, vars.title)
    .replace(/{{\s*date\s*}}/gi, vars.date)
    .replace(/{{\s*time\s*}}/gi, vars.time);
}

/** Trim/normalize a vault-relative folder path (no leading/trailing slashes). */
function cleanFolder(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
}

/**
 * Resolve the configured template folder, falling back to `templates` when the
 * setting is blank. Result is a vault-relative folder with no surrounding slashes.
 */
export function resolveTemplateFolder(raw: string | null | undefined): string {
  return cleanFolder(raw) || 'templates';
}

/**
 * Resolve the folder a note should be created in when no explicit folder context
 * exists. Vault root (`''`) unless the user picked a specific folder.
 */
export function resolveNewNoteFolder(
  location: 'root' | 'folder',
  folderPath: string | null | undefined,
): string {
  if (location !== 'folder') return '';
  return cleanFolder(folderPath);
}
