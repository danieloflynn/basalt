import { parseFrontmatter, serializeFrontmatter } from './frontmatter';

/** A frontmatter value that can be edited in place as a single text field. */
export type ScalarValue = string | number | boolean;

/** Scalars (string/number/boolean) are editable; everything else (nested
 * objects, dates, non-string arrays, null) is rendered read-only — we can't
 * faithfully round-trip what we don't understand. */
export function isEditableScalar(v: unknown): v is ScalarValue {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/** An array editable as pills (tags etc.): every item is a plain string. */
export function isEditableStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Coerce a freshly-typed input string to the SAME type as the value it's
 * replacing: a number stays a number when the input still parses as one, a
 * boolean stays a boolean when the input reads "true"/"false" — otherwise
 * (including every case where the original was already a string) the raw
 * input is kept as a string. An empty input is never special-cased away: it
 * becomes an empty string, not a deleted key.
 */
export function coerceScalarInput(original: unknown, input: string): ScalarValue {
  const trimmed = input.trim();
  if (typeof original === 'number' && trimmed !== '' && Number.isFinite(Number(trimmed))) {
    return Number(trimmed);
  }
  if (typeof original === 'boolean' && /^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === 'true';
  }
  return input;
}

/**
 * Set (or add) a single frontmatter key to `value` and re-serialize. Works
 * whether the note already has frontmatter, an empty/invalid block, or none
 * at all — adding the first property to a note with no frontmatter creates a
 * well-formed `---` block at the top. The body is never touched: it round-
 * trips byte-for-byte through parseFrontmatter/serializeFrontmatter.
 */
export function applyPropertyEdit(text: string, key: string, value: unknown): string {
  const fm = parseFrontmatter(text);
  const data = { ...fm.data, [key]: value };
  return serializeFrontmatter(data, fm.body);
}

/** Remove a frontmatter key entirely. A no-op (returns `text` unchanged) if the key isn't present. */
export function removeProperty(text: string, key: string): string {
  const fm = parseFrontmatter(text);
  if (!(key in fm.data)) return text;
  const data = { ...fm.data };
  delete data[key];
  return serializeFrontmatter(data, fm.body);
}

/** Append a string item to an array-valued property, creating the array if the key is absent/not an array. */
export function addArrayItem(text: string, key: string, item: string): string {
  const fm = parseFrontmatter(text);
  const current = Array.isArray(fm.data[key]) ? (fm.data[key] as unknown[]) : [];
  return applyPropertyEdit(text, key, [...current, item]);
}

/** Remove the first array item equal to `item` from an array-valued property. A no-op if not found. */
export function removeArrayItem(text: string, key: string, item: string): string {
  const fm = parseFrontmatter(text);
  const current = Array.isArray(fm.data[key]) ? (fm.data[key] as unknown[]) : [];
  const idx = current.indexOf(item);
  if (idx === -1) return text;
  const next = [...current.slice(0, idx), ...current.slice(idx + 1)];
  return applyPropertyEdit(text, key, next);
}
