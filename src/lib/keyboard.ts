import { Keyboard } from '@capacitor/keyboard';
import { isNativePlatform } from '@/engine';

/**
 * Raise the soft keyboard after a *programmatic* focus — the Android WebView
 * only shows it for user-initiated focus. No-op on web; harmless if the
 * keyboard is already up.
 */
export function showSoftKeyboard(): void {
  if (!isNativePlatform) return;
  void Keyboard.show().catch(() => undefined);
}
