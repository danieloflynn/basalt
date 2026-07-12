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
        // Replace through the WHOLE existing target, not just the typed prefix:
        // completing mid-link (`[[No|alias]]`, `[[Note]]`) must not strand the
        // old target/close and produce `[[Note]]|alias]]` or a doubled `]]`.
        apply: (view, _completion, from, to) => {
          const line = view.state.doc.lineAt(to);
          const rest = view.state.sliceDoc(to, line.to);
          // Untyped remainder of the target: run up to the next `|` (alias) or `]`.
          const tail = /^[^\]\n|]*/.exec(rest);
          const end = to + (tail ? tail[0].length : 0);
          const hasAlias = view.state.sliceDoc(end, end + 1) === '|';
          const closed = view.state.sliceDoc(end, end + 2) === ']]';
          // Only append `]]` when the link is neither already closed nor followed
          // by a `|alias]]` tail.
          const text = hasAlias || closed ? insert : `${insert}]]`;
          // Caret in POST-change coordinates: just past the inserted target
          // (before `|alias`), or past an existing `]]` when the link was closed.
          const anchor = closed ? from + text.length + 2 : from + text.length;
          view.dispatch({
            changes: { from, to: end, insert: text },
            selection: { anchor },
          });
        },
        type: 'text',
      };
    }),
    validFor: /^[^\[\]]*$/,
  };
}
