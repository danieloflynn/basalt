import { useEffect, useState } from 'react';
import { getGitEngine, vaultDir } from '@/engine';
import { diffLines, type DiffLine } from '@/lib/diff';
import { noteTitle } from '@/lib/paths';
import { vaultService } from '@/services';
import { useNav } from '@/state/nav';
import { Dialog } from '@/ui/components/Dialog';
import { IconBack, IconRestore } from '@/ui/icons';

/** One historical version of a note: diff against today, with restore (D-4). */
export function NoteVersionScreen({
  path,
  oid,
  when,
}: {
  path: string;
  oid: string;
  when: number;
}) {
  const nav = useNav();
  const [old, setOld] = useState<string | null | 'missing'>(null);
  const [current, setCurrent] = useState<string>('');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [showDiff, setShowDiff] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [content, now] = await Promise.all([
        getGitEngine().fileAtCommit({ dir: vaultDir(), oid, path }),
        vaultService.readNote(path).catch(() => ''),
      ]);
      if (cancelled) return;
      setOld(content ?? 'missing');
      setCurrent(now);
    })();
    return () => {
      cancelled = true;
    };
  }, [path, oid]);

  const dateLabel = new Date(when).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const diff: DiffLine[] =
    old !== null && old !== 'missing' ? diffLines(old, current) : [];
  const changed = diff.filter((d) => d.kind !== 'same').length;

  return (
    <div className="screen">
      <header className="workspace-top">
        <button className="iconbtn workspace-top__group" aria-label="Back" onClick={() => nav.back()}>
          <IconBack size={20} />
        </button>
        <span className="workspace-top__status">
          {noteTitle(path)} · {dateLabel}
        </span>
        <span style={{ flex: 1 }} />
        <div className="workspace-top__group">
          <button
            className="iconbtn"
            aria-label={showDiff ? 'Show full version' : 'Show changes'}
            style={{ fontSize: 'var(--text-xs)', width: 'auto', padding: '0 10px' }}
            onClick={() => setShowDiff((v) => !v)}
          >
            {showDiff ? 'Full text' : 'Changes'}
          </button>
          <button
            className="iconbtn iconbtn--accent"
            aria-label="Restore this version"
            onClick={() => setConfirmRestore(true)}
          >
            <IconRestore size={20} />
          </button>
        </div>
      </header>

      <div className="scroll" style={{ padding: '10px var(--pad-screen)' }}>
        {old === null && <div className="state" />}
        {old === 'missing' && (
          <div className="state">
            <p className="state__hint">This note didn't exist yet at that commit.</p>
          </div>
        )}
        {old !== null && old !== 'missing' && (
          <>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', padding: '2px 0 10px' }}>
              {showDiff
                ? changed === 0
                  ? 'Identical to the current note.'
                  : `${changed} changed line${changed === 1 ? '' : 's'} vs. now — red was in this version, green is in the current one.`
                : 'The note exactly as it was at this commit.'}
            </p>
            <pre className="diff">
              {showDiff
                ? diff.map((line, i) => (
                    <span key={i} className={`diff__line diff__line--${line.kind}`}>
                      {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}
                      {line.text}
                      {'\n'}
                    </span>
                  ))
                : old}
            </pre>
          </>
        )}
      </div>

      {confirmRestore && (
        <Dialog
          title="Restore this version?"
          message="The current note will be replaced with this older version. The replaced text stays safe in git history, so this is reversible."
          confirmLabel="Restore"
          onCancel={() => setConfirmRestore(false)}
          onConfirm={async () => {
            setConfirmRestore(false);
            if (old !== null && old !== 'missing') {
              await vaultService.writeNote(path, old);
              nav.push({ name: 'note', path });
            }
          }}
        />
      )}
    </div>
  );
}
