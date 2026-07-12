/**
 * Pure math for touch gestures (drawer swipe, pull-down). The DOM layer feeds
 * samples in; these functions decide what the gesture means. Kept free of DOM
 * so the decisions are unit-testable.
 */

export interface Sample {
  /** ms timestamp */
  t: number;
  x: number;
  y: number;
}

/** Movement below this is undecided; past it, one axis wins. */
export const AXIS_SLOP = 12;
/** Horizontal must beat vertical by this factor to claim the drawer. */
const AXIS_BIAS = 1.4;
/** Flicks faster than this (px/ms) override the halfway rule. */
export const FLING_VELOCITY = 0.35;
/** How much recent history informs the release velocity. */
const VELOCITY_WINDOW_MS = 100;
/**
 * If the finger lifts more than this after the last movement sample, the drag
 * ended in a hold, not a flick — the stale trailing velocity is discarded.
 */
const RELEASE_IDLE_MS = 100;

/**
 * Which axis a drag has committed to, or null while it's still ambiguous.
 * Horizontal needs a clear margin over vertical so sloppy scrolls don't
 * drag the drawer around.
 */
export function claimAxis(dx: number, dy: number, slop = AXIS_SLOP): 'x' | 'y' | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < slop && ay < slop) return null;
  if (ax >= ay * AXIS_BIAS) return 'x';
  if (ay >= ax) return 'y';
  return null;
}

/**
 * Signed x velocity in px/ms over the trailing window (0 if not enough data).
 * Pass `releaseTime` (the touchend timestamp) so a drag that moved fast, then
 * held still, then lifted doesn't register the stale flick: if the release lands
 * more than {@link RELEASE_IDLE_MS} after the last movement sample, velocity is
 * 0 and the position rule alone decides where the drawer settles.
 */
export function velocityX(samples: Sample[], releaseTime?: number): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  if (releaseTime !== undefined && releaseTime - last.t > RELEASE_IDLE_MS) return 0;
  let first = samples[0];
  for (const s of samples) {
    if (last.t - s.t <= VELOCITY_WINDOW_MS) {
      first = s;
      break;
    }
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return (last.x - first.x) / dt;
}

/**
 * How far open the drawer is (0 closed … 1 open) given the finger's travel.
 * `startOpen` anchors the gesture: closing drags subtract from 1.
 */
export function drawerProgress(startOpen: boolean, dx: number, width: number): number {
  if (width <= 0) return startOpen ? 1 : 0;
  const p = (startOpen ? width : 0) / width + dx / width;
  return Math.min(1, Math.max(0, p));
}

/**
 * Where the drawer should settle when the finger lifts: a decisive fling wins
 * regardless of position; otherwise past-halfway stays open.
 */
export function settleOpen(progress: number, velocity: number): boolean {
  if (velocity >= FLING_VELOCITY) return true;
  if (velocity <= -FLING_VELOCITY) return false;
  return progress >= 0.5;
}

/** Pull-down trigger: a clearly vertical drag past the threshold. */
export function pullTriggered(dx: number, dy: number, threshold = 90): boolean {
  return dy >= threshold && claimAxis(dx, dy) === 'y';
}
