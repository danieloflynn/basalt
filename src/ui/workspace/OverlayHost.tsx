import { useNav } from '@/state/nav';
import { CommandPalette } from '@/ui/components/CommandPalette';
import { QuickOpen } from '@/ui/components/QuickOpen';
import { TabsSheet } from '@/ui/components/TabsSheet';

/**
 * Renders the quick switcher / command palette / tab switcher, keyed on
 * `nav.overlay`. This used to be owned by BottomPill, which is mobile-only —
 * so on desktop these overlays were unreachable even though nav.setOverlay is
 * global (gestures, the desktop tab strip's "+", and now the global hotkeys
 * all drive it). Mounted once, unconditionally, in App.tsx so both the mobile
 * pill and desktop keyboard shortcuts reach the same overlays.
 */
export function OverlayHost() {
  const overlay = useNav((s) => s.overlay);
  const setOverlay = useNav((s) => s.setOverlay);

  if (overlay === 'none') return null;

  const onClose = () => setOverlay('none');

  switch (overlay) {
    case 'quickopen':
      return <QuickOpen onClose={onClose} />;
    case 'tabs':
      return <TabsSheet onClose={onClose} />;
    case 'palette':
      return <CommandPalette onClose={onClose} />;
  }
}
