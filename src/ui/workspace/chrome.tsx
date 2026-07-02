import { useNav } from '@/state/nav';

/** The top-left sidebar toggle, shared by every workspace screen. */
export function SidebarToggle() {
  const openSidebar = useNav((s) => s.openSidebar);
  return (
    <button
      className="iconbtn workspace-top__group"
      aria-label="Open sidebar"
      onClick={() => openSidebar()}
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
