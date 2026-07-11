import { tabLabel, useNav } from '@/state/nav';
import { IconPlus, IconX } from '@/ui/icons';

/**
 * The desktop-only top strip: window drag region, the open-tab bar, and the
 * backlinks-panel toggle. Only rendered in docked (desktop) mode — phones keep
 * the bottom pill + tabs sheet. The strip itself is a macOS title-bar drag
 * region (`-webkit-app-region: drag` in the CSS); interactive controls opt back
 * out with `no-drag`. In a plain browser the drag hints are simply inert.
 */
export function DesktopChrome() {
  const tabs = useNav((s) => s.tabs);
  const active = useNav((s) => s.active);
  const rightOpen = useNav((s) => s.rightSidebarOpen);
  const nav = useNav();

  return (
    <div className="desktop-chrome">
      {/* Reserves space under the macOS traffic lights (0 in a browser). */}
      <div className="desktop-chrome__traffic" aria-hidden="true" />
      <div className="desktop-tabs" role="tablist" aria-label="Open tabs">
        {tabs.map((tab, i) => (
          <div
            key={i}
            role="tab"
            aria-selected={i === active}
            tabIndex={0}
            className="desktop-tab"
            data-active={i === active || undefined}
            onClick={() => nav.switchTab(i)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                nav.switchTab(i);
              }
            }}
          >
            <span className="desktop-tab__label">{tabLabel(tab)}</span>
            <button
              className="desktop-tab__close"
              aria-label={`Close ${tabLabel(tab)}`}
              onClick={(e) => {
                e.stopPropagation();
                nav.closeTab(i);
              }}
            >
              <IconX size={14} />
            </button>
          </div>
        ))}
        <button className="desktop-tab__new" aria-label="New tab" onClick={() => nav.newTab()}>
          <IconPlus size={16} />
        </button>
      </div>
      <div className="desktop-chrome__drag" aria-hidden="true" />
      <button
        className="iconbtn desktop-chrome__toggle"
        aria-label="Toggle backlinks"
        aria-pressed={rightOpen}
        data-active={rightOpen || undefined}
        onClick={() => nav.toggleRightSidebar()}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M14.5 4v16" />
        </svg>
      </button>
    </div>
  );
}
