import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { stripExt } from '@/lib/paths';
import { vaultService } from '@/services';

/**
 * Typing "[[" suggests every note in the vault, filtered as you type (E-7).
 * Inserts "Title]]" (or "path/Title]]" when the bare title is ambiguous).
 */
export function wikilinkCompletions(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/\[\[([^\[\]]*)$/);
  if (!before) return null;

  const targets = vaultService.linkTargets();
  const titleCount = new Map<string, number>();
  for (const t of targets) {
    titleCount.set(t.title.toLowerCase(), (titleCount.get(t.title.toLowerCase()) ?? 0) + 1);
  }

  return {
    from: before.from + 2,
    options: targets.map((t) => {
      const ambiguous = (titleCount.get(t.title.toLowerCase()) ?? 0) > 1;
      const insert = ambiguous ? stripExt(t.path) : t.title;
      return {
        label: t.title,
        detail: ambiguous ? stripExt(t.path) : undefined,
        apply: `${insert}]]`,
        type: 'text',
      };
    }),
    validFor: /^[^\[\]]*$/,
  };
}
