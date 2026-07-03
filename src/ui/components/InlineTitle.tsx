import { useEffect, useRef, useState } from 'react';
import { showSoftKeyboard } from '@/lib/keyboard';
import { noteTitle } from '@/lib/paths';
import { vaultService } from '@/services';
import { useNav } from '@/state/nav';

interface InlineTitleProps {
  path: string;
  /** Fresh-note flow: focus + select the title on mount so typing names it. */
  autoFocus?: boolean;
  /**
   * Reading view (default) blurs on Enter to dismiss the mobile keyboard; the
   * edit screen passes false and instead moves focus into the body (keeping the
   * keyboard) from onCommitted.
   */
  blurOnEnter?: boolean;
  /** Flush any dirty editor buffer to the old path before we rename it. */
  onBeforeCommit?: () => void | Promise<void>;
  /** Fires after a successful commit (rename or no-op). */
  onCommitted?: (finalPath: string, info: { renamed: boolean; viaEnter: boolean }) => void;
}

/**
 * The note title, styled like the reading-view `.inline-title` h1 but editable
 * (Obsidian's "the inline title IS the filename"). A textarea, not an input, so
 * long titles wrap identically to the h1; newlines are forbidden. Enter/blur
 * commit (→ renameByTitle + nav.renamePath); Escape reverts.
 */
export function InlineTitle({
  path,
  autoFocus,
  blurOnEnter = true,
  onBeforeCommit,
  onCommitted,
}: InlineTitleProps) {
  const [value, setValue] = useState(() => noteTitle(path));
  const ref = useRef<HTMLTextAreaElement>(null);
  const committing = useRef(false);
  const skipBlur = useRef(false);
  const didAutoFocus = useRef(false);

  // Adopt external title changes (navigation, a rename driven from elsewhere).
  useEffect(() => {
    setValue(noteTitle(path));
  }, [path]);

  // Grow to fit wrapped lines (a textarea won't do this on its own).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    if (!autoFocus || didAutoFocus.current) return;
    didAutoFocus.current = true; // once, on first load — never re-trigger
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
    showSoftKeyboard(); // programmatic focus alone won't raise it on Android
  }, [autoFocus]);

  const commit = async (viaEnter: boolean) => {
    if (committing.current) return; // a rename is already in flight
    committing.current = true;
    try {
      await onBeforeCommit?.();
      const finalPath = await vaultService.renameByTitle(path, value);
      const renamed = finalPath !== path;
      if (renamed) useNav.getState().renamePath(path, finalPath);
      setValue(noteTitle(finalPath)); // reflect sanitize / dedupe / revert
      onCommitted?.(finalPath, { renamed, viaEnter });
    } finally {
      committing.current = false;
    }
  };

  return (
    <textarea
      ref={ref}
      className="inline-title"
      aria-label="Note title"
      rows={1}
      value={value}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      enterKeyHint="done"
      placeholder="Untitled"
      onChange={(e) => setValue(e.target.value.replace(/\n/g, ''))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (blurOnEnter) {
            skipBlur.current = true; // Enter already commits — don't double via blur
            e.currentTarget.blur(); // dismiss the mobile keyboard
          }
          // When kept focused, the caller moves focus to the body; the natural
          // blur that causes is ignored by the in-flight `committing` guard.
          void commit(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setValue(noteTitle(path)); // revert
          skipBlur.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        if (skipBlur.current) {
          skipBlur.current = false;
          return;
        }
        void commit(false);
      }}
    />
  );
}
