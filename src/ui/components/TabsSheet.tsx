import { tabLabel, useNav } from '@/state/nav';
import { IconPlus, IconX } from '@/ui/icons';

/** Tab switcher sheet (bottom pill "N" button). */
export function TabsSheet({ onClose }: { onClose: () => void }) {
  const nav = useNav();

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet">
        <div className="sheet__grab" />
        {nav.tabs.map((tab, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
            <button
              className="sheet__item"
              style={i === nav.active ? { color: 'var(--ember)', fontWeight: 600 } : undefined}
              onClick={() => {
                nav.switchTab(i);
                onClose();
              }}
            >
              {tabLabel(tab)}
            </button>
            <button
              className="iconbtn"
              aria-label={`Close tab ${tabLabel(tab)}`}
              onClick={() => nav.closeTab(i)}
            >
              <IconX size={16} />
            </button>
          </div>
        ))}
        <button
          className="sheet__item"
          onClick={() => {
            nav.newTab();
            onClose();
          }}
        >
          <span className="row__icon">
            <IconPlus size={18} />
          </span>
          New tab
        </button>
      </div>
    </>
  );
}
