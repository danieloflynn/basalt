import { syncService, useSync } from '@/services';

/**
 * The sync indicator: four basalt columns that glow ember while syncing.
 * Rock = settled; lit center column = local changes waiting; red = attention.
 */
export function SyncStatus() {
  const { phase, pendingCount, conflictCopies } = useSync();

  const state =
    conflictCopies.length > 0
      ? 'conflict'
      : phase === 'committing' || phase === 'pulling' || phase === 'pushing'
        ? 'syncing'
        : phase === 'error'
          ? 'error'
          : phase === 'offline'
            ? 'offline'
            : pendingCount > 0
              ? 'pending'
              : 'idle';

  return (
    <button
      className="iconbtn"
      aria-label={`Sync: ${label(state)}. Sync now.`}
      onClick={() => void syncService.syncNow('manual')}
    >
      <div className="sync-columns" data-state={state}>
        <div className="col" />
        <div className="col" />
        <div className="col" />
        <div className="col" />
      </div>
    </button>
  );
}

function label(state: string): string {
  switch (state) {
    case 'syncing':
      return 'syncing';
    case 'pending':
      return 'changes waiting to sync';
    case 'error':
      return 'sync error';
    case 'conflict':
      return 'conflict copies were created';
    case 'offline':
      return 'offline — will sync when connected';
    default:
      return 'up to date';
  }
}

function Subtitle() {
  const { phase, lastSyncAt, pendingCount } = useSync();
  let text: string;
  if (phase === 'committing') text = 'Saving…';
  else if (phase === 'pulling') text = 'Pulling changes…';
  else if (phase === 'pushing') text = 'Pushing…';
  else if (phase === 'offline') text = 'Offline — changes saved locally';
  else if (phase === 'error') text = 'Sync needs attention';
  else if (pendingCount > 0) text = 'Changes pending';
  else if (lastSyncAt) text = `Synced ${timeAgo(lastSyncAt)}`;
  else text = 'Not synced yet';
  return <span className="topbar__subtitle">{text}</span>;
}

SyncStatus.Subtitle = Subtitle;

export function timeAgo(when: number): string {
  const sec = Math.round((Date.now() - when) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return day === 1 ? 'yesterday' : `${day} days ago`;
}
