import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function I({ size = 22, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconBack = (p: P) => (
  <I {...p}>
    <path d="M19 12H5" />
    <path d="m11 18-6-6 6-6" />
  </I>
);

export const IconSearch = (p: P) => (
  <I {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.4-3.4" />
  </I>
);

export const IconSettings = (p: P) => (
  // A real cog — teeth around the rim and a hollow hub — not a sun of spokes.
  <I {...p}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
    <circle cx="12" cy="12" r="3" />
  </I>
);

export const IconPlus = (p: P) => (
  <I {...p}>
    <path d="M12 5v14M5 12h14" />
  </I>
);

export const IconPencil = (p: P) => (
  <I {...p}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </I>
);

export const IconFolder = (p: P) => (
  <I {...p}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </I>
);

export const IconFolderPlus = (p: P) => (
  <I {...p}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    <path d="M12 10v6M9 13h6" />
  </I>
);

export const IconNote = (p: P) => (
  <I {...p}>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </I>
);

export const IconNotePlus = (p: P) => (
  <I {...p}>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M12 11v6M9 14h6" />
  </I>
);

export const IconImage = (p: P) => (
  <I {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
  </I>
);

export const IconChevronRight = (p: P) => (
  <I {...p}>
    <path d="m9 18 6-6-6-6" />
  </I>
);

export const IconDots = (p: P) => (
  <I {...p}>
    <circle cx="12" cy="5" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
  </I>
);

export const IconHistory = (p: P) => (
  <I {...p}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </I>
);

export const IconTrash = (p: P) => (
  <I {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </I>
);

export const IconRename = (p: P) => (
  <I {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </I>
);

export const IconCheck = (p: P) => (
  <I {...p}>
    <path d="M20 6 9 17l-5-5" />
  </I>
);

export const IconX = (p: P) => (
  <I {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </I>
);

export const IconSync = (p: P) => (
  <I {...p}>
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 16h5v5" />
  </I>
);

export const IconAlert = (p: P) => (
  <I {...p}>
    <path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z" />
    <path d="M12 9v4M12 17h.01" />
  </I>
);

export const IconGit = (p: P) => (
  <I {...p}>
    <circle cx="12" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M12 8.5v2a3 3 0 0 1-3 3H8a3 3 0 0 0-2 .8M12 8.5v2a3 3 0 0 0 3 3h1a3 3 0 0 1 2 .8" />
  </I>
);

export const IconBold = (p: P) => (
  <I {...p}>
    <path d="M7 4h7a3.5 3.5 0 0 1 0 7H7ZM7 11h8a3.5 3.5 0 0 1 0 7H7Z" />
  </I>
);

export const IconItalic = (p: P) => (
  <I {...p}>
    <path d="M19 4h-9M14 20H5M15 4 9 20" />
  </I>
);

export const IconHeading = (p: P) => (
  <I {...p}>
    <path d="M6 4v16M18 4v16M6 12h12" />
  </I>
);

export const IconList = (p: P) => (
  <I {...p}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </I>
);

export const IconTodo = (p: P) => (
  <I {...p}>
    <rect x="3" y="5" width="6" height="6" rx="1.5" />
    <path d="m4.5 8 1.2 1.2L8 6.9" />
    <path d="M13 8h8M13 16h8" />
    <rect x="3" y="13" width="6" height="6" rx="1.5" />
  </I>
);

export const IconWikilink = (p: P) => (
  <I {...p}>
    <path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2" />
  </I>
);

export const IconUndo = (p: P) => (
  <I {...p}>
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
  </I>
);

export const IconRedo = (p: P) => (
  <I {...p}>
    <path d="M21 7v6h-6" />
    <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
  </I>
);

export const IconEye = (p: P) => (
  <I {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </I>
);

export const IconClock = (p: P) => (
  <I {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </I>
);

export const IconCode = (p: P) => (
  <I {...p}>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
  </I>
);

export const IconTabs = (p: P) => (
  <I {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
  </I>
);

export const IconStar = (p: P) => (
  <I {...p}>
    <path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6-5.4-2.9L6.6 19.7l1.1-6L3.2 9.4l6.1-.8Z" />
  </I>
);

export const IconTag = (p: P) => (
  <I {...p}>
    <path d="M12.6 2.6a2 2 0 0 0-1.4-.6H4a2 2 0 0 0-2 2v7.2c0 .5.2 1 .6 1.4l8.8 8.8a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8Z" />
    <circle cx="7.5" cy="7.5" r="1" fill="currentColor" />
  </I>
);

export const IconGraph = (p: P) => (
  <I {...p}>
    <circle cx="5.5" cy="6" r="2.5" />
    <circle cx="18" cy="5" r="2" />
    <circle cx="17" cy="17.5" r="2.5" />
    <circle cx="6" cy="18" r="2" />
    <path d="M7.8 7.4 15.3 16M7.9 6.5 16 5.4M7.4 16.9l7.2.5" />
  </I>
);

export const IconWand = (p: P) => (
  // A magic wand with a sparkle — the graph timelapse trigger.
  <I {...p}>
    <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5" />
  </I>
);

export const IconCommand = (p: P) => (
  <I {...p}>
    <path d="M9 9V5.5a2.5 2.5 0 1 0-2.5 2.5H9Zm0 0v6m0-6h6M9 15H5.5A2.5 2.5 0 1 0 8 17.5V15Zm6 0v3.5a2.5 2.5 0 1 0 2.5-2.5H15Zm0 0V9m0 6H9m6-6h3.5A2.5 2.5 0 1 0 16 6.5V9Z" />
  </I>
);

export const IconCalendar = (p: P) => (
  <I {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 10h18" />
  </I>
);

export const IconMove = (p: P) => (
  <I {...p}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    <path d="m10 13 3 3-3 3M13 16H7" />
  </I>
);

export const IconRestore = (p: P) => (
  <I {...p}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </I>
);

export const IconCopy = (p: P) => (
  <I {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </I>
);

// ---- Editor toolbar formatting icons ----

export const IconStrike = (p: P) => (
  <I {...p}>
    <path d="M16 4H9a3 3 0 0 0-2.83 4" />
    <path d="M14 12a4 4 0 0 1 0 8H6" />
    <path d="M4 12h16" />
  </I>
);

export const IconHighlight = (p: P) => (
  <I {...p}>
    <path d="m9 11-6 6v3h9l3-3" />
    <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
  </I>
);

export const IconQuote = (p: P) => (
  <I {...p}>
    <path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2Z" />
    <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2Z" />
  </I>
);

export const IconLink = (p: P) => (
  <I {...p}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </I>
);

export const IconListNumbered = (p: P) => (
  <I {...p}>
    <path d="M10 6h11M10 12h11M10 18h11" />
    <path d="M4 6h1v4M4 10h2" />
    <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
  </I>
);

export const IconIndent = (p: P) => (
  <I {...p}>
    <path d="m4 8 4 4-4 4" />
    <path d="M12 6h9M12 12h9M12 18h9" />
  </I>
);

export const IconOutdent = (p: P) => (
  <I {...p}>
    <path d="m8 8-4 4 4 4" />
    <path d="M12 6h9M12 12h9M12 18h9" />
  </I>
);

export const IconAttach = (p: P) => (
  <I {...p}>
    <path d="M21.4 11 12.25 20.2a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.19 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </I>
);

export const IconEmbed = (p: P) => (
  <I {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </I>
);

export const IconHash = (p: P) => (
  <I {...p}>
    <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
  </I>
);
