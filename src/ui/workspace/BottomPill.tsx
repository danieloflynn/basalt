import { vaultService } from '@/services';
import { useNav } from '@/state/nav';
import { defaultNewNoteFolder } from '@/ui/templates';
import { IconBack, IconCommand, IconPlus, IconSearch } from '@/ui/icons';

/**
 * Obsidian's floating bottom toolbar: back / forward / quick open / new note /
 * tabs / command palette. Overlay state lives in nav so gestures (pull-down)
 * can open Quick Open too. The overlays themselves render from `OverlayHost`
 * (mounted once in App.tsx) — this component is just the pill's buttons.
 */
export function BottomPill() {
  const nav = useNav();
  const tabCount = useNav((s) => s.tabs.length);
  const setOverlay = nav.setOverlay;

  return (
    <div className="bottompill">
      <button
        className="iconbtn"
        aria-label="Back"
        disabled={!nav.canBack()}
        onClick={() => nav.back()}
      >
        <IconBack size={20} style={{ opacity: nav.canBack() ? 1 : 0.35 }} />
      </button>
      <button
        className="iconbtn"
        aria-label="Forward"
        disabled={!nav.canForward()}
        onClick={() => nav.forward()}
      >
        <IconBack
          size={20}
          style={{ transform: 'rotate(180deg)', opacity: nav.canForward() ? 1 : 0.35 }}
        />
      </button>
      <button className="iconbtn" aria-label="Quick open" onClick={() => setOverlay('quickopen')}>
        <IconSearch size={21} />
      </button>
      <button
        className="iconbtn"
        aria-label="New note"
        onClick={async () => {
          const path = await vaultService.createNote(defaultNewNoteFolder(), 'Untitled');
          nav.push({ name: 'edit', path });
        }}
      >
        <IconPlus size={22} />
      </button>
      <button className="iconbtn bottompill__tabs" aria-label="Tabs" onClick={() => setOverlay('tabs')}>
        <span className="bottompill__tabcount">{tabCount}</span>
      </button>
      <button className="iconbtn" aria-label="Command palette" onClick={() => setOverlay('palette')}>
        <IconCommand size={20} />
      </button>
    </div>
  );
}
