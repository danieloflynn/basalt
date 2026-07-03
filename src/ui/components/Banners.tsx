import { useState } from 'react';
import { syncService, useSync } from '@/services';
import { openNote } from '@/state/nav';
import { noteTitle } from '@/lib/paths';
import { IconX } from '@/ui/icons';

/** Conflict and sync-error notices (SY-4, D-2). Rendered under the top bar. */
export function Banners() {
  const { conflictCopies, phase, error } = useSync();
  // Locally dismiss the current error message so a persistent failure can't
  // sit on top of the workspace forever. A new/different error shows again;
  // the ambient sync indicator stays red until sync actually recovers.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const showError = phase === 'error' && error !== null && error !== dismissed;

  return (
    <>
      {conflictCopies.length > 0 && (
        <div className="banner banner--conflict" role="alert">
          <div className="banner__body">
            <p className="banner__title">Both versions kept</p>
            <p>
              A note changed on this phone and elsewhere at the same time. Your phone's
              version was saved as{' '}
              {conflictCopies.map((p, i) => (
                <span key={p}>
                  {i > 0 && ', '}
                  <a
                    style={{ fontWeight: 600 }}
                    onClick={(e) => {
                      e.preventDefault();
                      openNote(p);
                    }}
                  >
                    {noteTitle(p)}
                  </a>
                </span>
              ))}
              . Merge them whenever you like — nothing was lost.
            </p>
          </div>
          <button className="banner__action" onClick={() => syncService.dismissConflicts()}>
            Got it
          </button>
        </div>
      )}

      {showError && (
        <div className="banner banner--error" role="alert">
          <div className="banner__body">
            <p className="banner__title">Sync hit a problem</p>
            <p>{error}</p>
          </div>
          <button className="banner__action" onClick={() => void syncService.syncNow('retry')}>
            Retry
          </button>
          <button
            className="banner__dismiss"
            aria-label="Dismiss"
            onClick={() => setDismissed(error)}
          >
            <IconX size={16} />
          </button>
        </div>
      )}
    </>
  );
}
