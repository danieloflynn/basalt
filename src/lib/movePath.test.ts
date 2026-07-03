import { describe, expect, it } from 'vitest';
import { moveDestination } from './movePath';

const takenIn = (...paths: string[]) => {
  const set = new Set(paths.map((p) => p.toLowerCase()));
  return (candidate: string) => set.has(candidate.toLowerCase());
};

describe('moveDestination', () => {
  it('keeps the basename when the target folder is free', () => {
    expect(moveDestination('Welcome.md', 'Projects', takenIn())).toBe('Projects/Welcome.md');
  });

  it('moves out of a folder to the root', () => {
    expect(moveDestination('Projects/Basalt.md', '', takenIn())).toBe('Basalt.md');
  });

  it('dedupes with a " 2" suffix before the extension, like createNote', () => {
    expect(
      moveDestination('Welcome.md', 'Projects', takenIn('Projects/Welcome.md')),
    ).toBe('Projects/Welcome 2.md');
  });

  it('keeps counting when the suffixed name is taken too', () => {
    expect(
      moveDestination(
        'Welcome.md',
        'Projects',
        takenIn('Projects/Welcome.md', 'Projects/Welcome 2.md'),
      ),
    ).toBe('Projects/Welcome 3.md');
  });

  it('dedupes case-insensitively (Android FS), via the caller-supplied check', () => {
    expect(
      moveDestination('Welcome.md', 'Projects', takenIn('projects/welcome.MD')),
    ).toBe('Projects/Welcome 2.md');
  });

  it('suffixes attachments before their extension', () => {
    expect(
      moveDestination('img.png', 'attachments', takenIn('attachments/img.png')),
    ).toBe('attachments/img 2.png');
  });

  it('treats extensionless names as a whole stem', () => {
    expect(moveDestination('Makefile', 'tools', takenIn('tools/Makefile'))).toBe(
      'tools/Makefile 2',
    );
  });

  it('treats a dotfile as a whole name (leading dot is not an extension)', () => {
    expect(moveDestination('.gitignore', 'cfg', takenIn('cfg/.gitignore'))).toBe(
      'cfg/.gitignore 2',
    );
  });

  it('splits only the final extension of a multi-dot name', () => {
    expect(moveDestination('a.tar.gz', 'out', takenIn('out/a.tar.gz'))).toBe('out/a.tar 2.gz');
  });

  it('keeps counting when a stem already ends in " 2"', () => {
    expect(moveDestination('Note 2.md', 'f', takenIn('f/Note 2.md'))).toBe('f/Note 2 2.md');
  });

  it('moves into a nested destination folder', () => {
    expect(moveDestination('x.md', 'a/b/c', takenIn())).toBe('a/b/c/x.md');
  });
});
