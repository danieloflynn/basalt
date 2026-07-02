import { syncService, useSync } from '@/services';
import { openNote } from '@/state/nav';
import { noteTitle } from '@/lib/paths';

/** Conflict and sync-error notices (SY-4, D-2). Rendered under the top bar. */
export function Banners() {
  const { conflictCopies, phase, error } = useSync();

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

      {phase === 'error' && error && (
        <div className="banner banner--error" role="alert">
          <div className="banner__body">
            <p className="banner__title">Sync hit a problem</p>
            <p>{error}</p>
          </div>
          <button className="banner__action" onClick={() => void syncService.syncNow('retry')}>
            Retry
          </button>
        </div>
      )}
    </>
  );
}
