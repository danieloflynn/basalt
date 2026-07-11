import { useEffect, useRef, useState } from 'react';
import { type AppCommand, listCommands } from '@/commands/registry';
import {
  addBinding,
  effectiveHotkeys,
  eventToChord,
  formatChord,
  isOverridden,
  removeBinding,
  resetBinding,
  setHotkeyCapture,
} from '@/services/hotkeys';
import { useSettings } from '@/services';
import { IconPlus, IconRestore, IconX } from '@/ui/icons';

/** Commands (besides `selfId`) whose effective list also contains `chord`. */
function findConflicts(
  commands: AppCommand[],
  hotkeys: Record<string, string[]>,
  selfId: string,
  chord: string,
): AppCommand[] {
  return commands.filter((c) => c.id !== selfId && (hotkeys[c.id]?.includes(chord) ?? false));
}

/**
 * Obsidian-style "Hotkeys" settings section body: searchable command list,
 * per-command chord chips (remove / restore-default), and a `+` button to
 * record a new binding. Works identically on Android (Bluetooth keyboard) and
 * desktop — no platform gating.
 *
 * Every change persists immediately via `useSettings.getState().update`, so
 * this component holds no "unsaved" state of its own besides the search
 * query, the bound-only filter, and which row (if any) is currently
 * recording.
 */
export function HotkeySettings() {
  const { settings } = useSettings();
  const overrides = settings.hotkeys ?? {};
  const [query, setQuery] = useState('');
  const [boundOnly, setBoundOnly] = useState(false);
  const [recordingId, setRecordingId] = useState<string | null>(null);

  const commands = listCommands();
  const hotkeys = effectiveHotkeys();

  const q = query.trim().toLowerCase();
  const filtered = commands.filter((c) => {
    if (q && !c.name.toLowerCase().includes(q)) return false;
    if (boundOnly && (hotkeys[c.id]?.length ?? 0) === 0) return false;
    return true;
  });

  const persist = (next: Record<string, string[]>) => {
    void useSettings.getState().update({ hotkeys: next });
  };

  return (
    <>
      <input
        className="search-input"
        style={{ width: '100%', marginBottom: 10 }}
        placeholder="Filter commands…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        className="hotkeys-filter"
        aria-pressed={boundOnly}
        onClick={() => setBoundOnly((v) => !v)}
      >
        Bound only
      </button>
      <div className="card" style={{ marginTop: 10 }}>
        {filtered.length === 0 && (
          <p className="state__hint" style={{ padding: 14 }}>
            No matching commands
          </p>
        )}
        {filtered.map((c) => (
          <HotkeyRow
            key={c.id}
            command={c}
            chords={hotkeys[c.id] ?? []}
            overridden={isOverridden(overrides, c.id)}
            recording={recordingId === c.id}
            allCommands={commands}
            allHotkeys={hotkeys}
            onStartRecording={() => setRecordingId(c.id)}
            onStopRecording={() => setRecordingId((id) => (id === c.id ? null : id))}
            onAdd={(chord) => persist(addBinding(overrides, c.id, chord))}
            onRemove={(chord) => persist(removeBinding(overrides, c.id, chord))}
            onReset={() => persist(resetBinding(overrides, c.id))}
          />
        ))}
      </div>
    </>
  );
}

function HotkeyRow({
  command,
  chords,
  overridden,
  recording,
  allCommands,
  allHotkeys,
  onStartRecording,
  onStopRecording,
  onAdd,
  onRemove,
  onReset,
}: {
  command: AppCommand;
  chords: string[];
  overridden: boolean;
  recording: boolean;
  allCommands: AppCommand[];
  allHotkeys: Record<string, string[]>;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onAdd: (chord: string) => void;
  onRemove: (chord: string) => void;
  onReset: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  // Recording lifecycle: arm global-hotkey suppression + a capture-phase
  // keydown listener while `recording` is true. First real chord wins;
  // Escape cancels without binding. The cleanup (unmount, `recording` flips
  // false because another row started recording, or the effect re-runs)
  // always disarms suppression — so a mid-recording unmount can't leave the
  // global handler permanently suppressed.
  useEffect(() => {
    if (!recording) return;
    setHotkeyCapture(true);
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onStopRecording();
        return;
      }
      const chord = eventToChord(e);
      if (!chord) return;
      e.preventDefault();
      e.stopPropagation();
      onAdd(chord);
      onStopRecording();
    };
    window.addEventListener('keydown', handler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      setHotkeyCapture(false);
    };
  }, [recording, onAdd, onStopRecording]);

  // Blur cancels recording too (tapping elsewhere on a touch device with no
  // Escape key) — but not when focus merely moves to another control inside
  // this same row (e.g. the record button itself receiving focus).
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!recording) return;
    const next = e.relatedTarget;
    if (rowRef.current && next instanceof Node && rowRef.current.contains(next)) return;
    onStopRecording();
  };

  const conflicts = chords.flatMap((chord) =>
    findConflicts(allCommands, allHotkeys, command.id, chord).map((other) => ({ chord, other })),
  );

  return (
    <div className="setting hotkey-row" ref={rowRef} onBlur={handleBlur}>
      <div className="setting__body">
        <p className="setting__label">{command.name}</p>
        {conflicts.length > 0 && (
          <p className="hotkey-row__conflict">
            {conflicts
              .map(({ chord, other }) => `${formatChord(chord)} also runs "${other.name}"`)
              .join(' · ')}
          </p>
        )}
      </div>
      <div className="hotkey-row__chords">
        {chords.map((chord) => (
          <span className="hotkey-chip" key={chord}>
            {formatChord(chord)}
            <button
              className="hotkey-chip__remove"
              aria-label={`Remove ${formatChord(chord)} from ${command.name}`}
              onClick={() => onRemove(chord)}
            >
              <IconX size={12} />
            </button>
          </span>
        ))}
        {recording && <span className="hotkey-chip hotkey-chip--recording">Press hotkey…</span>}
        {overridden && (
          <button className="iconbtn" aria-label="Restore default" onClick={onReset}>
            <IconRestore size={16} />
          </button>
        )}
        <button
          className="iconbtn"
          aria-pressed={recording}
          aria-label={recording ? `Cancel recording for ${command.name}` : `Record new hotkey for ${command.name}`}
          onClick={() => (recording ? onStopRecording() : onStartRecording())}
        >
          <IconPlus size={16} />
        </button>
      </div>
    </div>
  );
}
