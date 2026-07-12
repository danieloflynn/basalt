import { useNav } from '@/state/nav';
import { PaneContext } from '@/ui/workspace/PaneContext';
import { WorkspaceScreen } from '@/ui/workspace/WorkspaceScreen';

/**
 * Obsidian's split pane ("Open to the right"): a FULL second pane — its own
 * per-pane history (back/forward via the pane header), reading AND editing
 * views, links and file-tree opens landing in whichever pane is focused.
 * Renders the exact same WorkspaceScreen switch as the main pane, wrapped in
 * a 'split' PaneContext so pane headers show this pane's state and carry the
 * close-split control. Desktop-only: App mounts it only in docked mode.
 */
export function SplitPane() {
  const split = useNav((s) => s.split);
  if (split === null) return null;
  const screen = split.history[split.index];
  return (
    <div className="split-pane">
      <PaneContext.Provider value="split">
        <WorkspaceScreen screen={screen} />
      </PaneContext.Provider>
    </div>
  );
}
