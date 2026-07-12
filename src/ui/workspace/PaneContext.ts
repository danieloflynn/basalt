import { createContext, useContext } from 'react';

/**
 * Which workspace pane a screen is rendered in. The main pane is the default
 * (mobile has nothing else); the desktop split pane wraps its screens in a
 * 'split' provider so pane headers show THEIR pane's history state and the
 * split's header carries the close-split control.
 */
export const PaneContext = createContext<'main' | 'split'>('main');

export function usePane(): 'main' | 'split' {
  return useContext(PaneContext);
}
