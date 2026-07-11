import { useEffect, useRef, useState } from 'react';
import { tabLabel, useNav } from '@/state/nav';
import { IconCheck, IconChevronRight, IconPlus, IconX } from '@/ui/icons';
import { VIEWS } from './Sidebar';

/**
 * The desktop-only titlebar: window drag region, the sidebar view-switcher
 * cluster + sidebar toggle (left), the open-tab bar (center), and the
 * tab-list dropdown + backlinks-panel toggle (right). Only rendered in docked
 * (desktop) mode — phones keep the bottom pill + tabs sheet. The strip itself
 * is a macOS title-bar drag region (`-webkit-app-region: drag` in the CSS);
 * interactive controls opt back out with `no-drag`. In a plain browser the
 * drag hints are simply inert.
 */
export function DesktopChrome() {
  const tabs = useNav((s) => s.tabs);
  const active = useNav((s) => s.active);
  const rightOpen = useNav((s) => s.rightSidebarOpen);
  const sidebarOpen = useNav((s) => s.sidebarOpen);
  const sidebarView = useNav((s) => s.sidebarView);
  const nav = useNav();
  const [tabListOpen, setTabListOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Click-away / Escape closes the tab-list popup, mirroring VaultMenu's popup
  // pattern — listeners are only live while the popup is actually open.
  useEffect(() => {
    if (!tabListOpen) return;
    const onDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTabListOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTabListOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [tabListOpen]);

  return (
    <div className="desktop-chrome">
      {/* Reserves space under the macOS traffic lights (0 in a browser). */}
      <div className="desktop-chrome__traffic" aria-hidden="true" />

      {/* Sidebar view-switcher cluster — desktop's replacement for the
          in-panel switcher, only shown while the sidebar is docked open. */}
      {sidebarOpen && (
        <div className="titlebar-switcher" role="tablist" aria-label="Sidebar views">
          {VIEWS.map((v) => (
            <button
              key={v.view}
              className="titlebar-switcher__item"
              data-active={v.view === sidebarView || undefined}
              role="tab"
              aria-selected={v.view === sidebarView}
              aria-label={v.label}
              title={v.label}
              onClick={() => nav.setSidebarView(v.view)}
            >
              {v.icon({ size: 18 })}
            </button>
          ))}
        </div>
      )}

      <button
        className="iconbtn desktop-chrome__toggle"
        aria-label="Toggle sidebar"
        aria-pressed={sidebarOpen}
        data-active={sidebarOpen || undefined}
        onClick={() => nav.toggleSidebar()}
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
          <path d="M9.5 4v16" />
        </svg>
      </button>

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

      <div className="tablist-dropdown" ref={dropdownRef}>
        <button
          className="iconbtn desktop-chrome__toggle"
          aria-label="List open tabs"
          aria-expanded={tabListOpen}
          data-active={tabListOpen || undefined}
          onClick={() => setTabListOpen((v) => !v)}
        >
          <IconChevronRight size={16} style={{ transform: 'rotate(90deg)' }} />
        </button>
        {tabListOpen && (
          <div className="tablist-menu" role="menu" aria-label="Open tabs">
            {tabs.map((tab, i) => (
              <button
                key={i}
                className="tablist-menu__item"
                data-active={i === active || undefined}
                role="menuitemradio"
                aria-checked={i === active}
                onClick={() => {
                  nav.switchTab(i);
                  setTabListOpen(false);
                }}
              >
                <span className="tablist-menu__label">{tabLabel(tab)}</span>
                {i === active && <IconCheck size={14} />}
              </button>
            ))}
          </div>
        )}
      </div>

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
