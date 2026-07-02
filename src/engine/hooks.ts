import { useEffect, useState } from 'react';
import { getGitEngine, VAULT_DIR } from './index';
import type { GitProgress } from './types';

export { getGitEngine, VAULT_DIR };

/** Live progress events from the git engine (clone/fetch/push). */
export function useSyncProgress(): GitProgress | null {
  const [progress, setProgress] = useState<GitProgress | null>(null);
  useEffect(() => getGitEngine().onProgress(setProgress), []);
  return progress;
}
