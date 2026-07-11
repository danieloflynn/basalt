import { useNav } from '@/state/nav';

/**
 * The top-left sidebar toggle, shared by every workspace screen. On desktop
 * the titlebar cluster (DesktopChrome) owns this control instead, so screens
 * render nothing here in docked mode — mobile keeps it.
 */
export function SidebarToggle() {
  const openSidebar = useNav((s) => s.openSidebar);
  const toggleSidebar = useNav((s) => s.toggleSidebar);
  const desktop = useNav((s) => s.desktop);
  if (desktop) return null;
  return (
    <button
      className="iconbtn workspace-top__group"
      aria-label={desktop ? 'Toggle sidebar' : 'Open sidebar'}
      onClick={() => (desktop ? toggleSidebar() : openSidebar())}
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
  );
}
