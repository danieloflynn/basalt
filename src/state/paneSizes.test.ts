import { beforeEach, describe, expect, it } from 'vitest';
import { clamp, PANE_DEFAULTS, PANE_LIMITS, usePaneSizes } from './paneSizes';

describe('paneSizes store', () => {
  beforeEach(() => {
    usePaneSizes.setState({ ...PANE_DEFAULTS });
  });

  it('starts at the defaults', () => {
    const s = usePaneSizes.getState();
    expect(s.sidebarW).toBe(PANE_DEFAULTS.sidebarW);
    expect(s.rightbarW).toBe(PANE_DEFAULTS.rightbarW);
    expect(s.splitRatio).toBe(PANE_DEFAULTS.splitRatio);
  });

  it('clamps drags to the pane limits', () => {
    const s = usePaneSizes.getState();
    s.setSidebarW(20);
    expect(usePaneSizes.getState().sidebarW).toBe(PANE_LIMITS.sidebarW.min);
    s.setSidebarW(5000);
    expect(usePaneSizes.getState().sidebarW).toBe(PANE_LIMITS.sidebarW.max);
    s.setRightbarW(0);
    expect(usePaneSizes.getState().rightbarW).toBe(PANE_LIMITS.rightbarW.min);
    s.setSplitRatio(0.05);
    expect(usePaneSizes.getState().splitRatio).toBe(PANE_LIMITS.splitRatio.min);
    s.setSplitRatio(0.99);
    expect(usePaneSizes.getState().splitRatio).toBe(PANE_LIMITS.splitRatio.max);
  });

  it('rounds pixel widths and keeps ratios fractional', () => {
    const s = usePaneSizes.getState();
    s.setSidebarW(300.7);
    expect(usePaneSizes.getState().sidebarW).toBe(301);
    s.setSplitRatio(0.333);
    expect(usePaneSizes.getState().splitRatio).toBeCloseTo(0.333);
  });

  it('reset restores a single dimension to its default', () => {
    const s = usePaneSizes.getState();
    s.setSidebarW(400);
    s.setRightbarW(500);
    s.reset('sidebarW');
    expect(usePaneSizes.getState().sidebarW).toBe(PANE_DEFAULTS.sidebarW);
    expect(usePaneSizes.getState().rightbarW).toBe(500);
  });

  it('clamp is a plain min/max helper', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});
