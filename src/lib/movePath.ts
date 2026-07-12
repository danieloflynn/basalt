import { basename, joinPath } from './paths';

/**
 * Destination path for moving a file into `toFolder`: same name, new folder,
 * deduped with the same " 2" suffix rule as note creation when the target
 * name is taken (`isTaken` should be case-insensitive on Android's FS and
 * must not count the file's own current path). Pure so vault.moveFile's
 * dedupe is unit-testable without the engine.
 */
export function moveDestination(
  from: string,
  toFolder: string,
  isTaken: (candidate: string) => boolean,
): string {
  const name = basename(from);
  const dot = name.lastIndexOf('.');
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const ext = dot <= 0 ? '' : name.slice(dot);
  let candidate = joinPath(toFolder, name);
  let n = 2;
  while (isTaken(candidate)) {
    candidate = joinPath(toFolder, `${stem} ${n}${ext}`);
    n++;
  }
  return candidate;
}
