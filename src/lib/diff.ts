export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/**
 * Line diff via LCS, sized for notes (quadratic DP capped; falls back to a
 * plain replace-all view on very large inputs).
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  if (a.length * b.length > 400_000) {
    return [
      ...a.map((text) => ({ kind: 'removed', text }) as DiffLine),
      ...b.map((text) => ({ kind: 'added', text }) as DiffLine),
    ];
  }

  // LCS table
  const m = a.length;
  const n = b.length;
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'removed', text: a[i] });
      i++;
    } else {
      out.push({ kind: 'added', text: b[j] });
      j++;
    }
  }
  while (i < m) out.push({ kind: 'removed', text: a[i++] });
  while (j < n) out.push({ kind: 'added', text: b[j++] });
  return out;
}
