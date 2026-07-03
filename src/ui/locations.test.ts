import { describe, expect, it } from 'vitest';
import { fillTemplateVars, resolveNewNoteFolder, resolveTemplateFolder } from './locations';

describe('fillTemplateVars', () => {
  const vars = { title: 'My Note', date: '2026-07-03', time: '09:41' };

  it('substitutes title, date and time', () => {
    expect(fillTemplateVars('# {{title}}\n{{date}} {{time}}', vars)).toBe(
      '# My Note\n2026-07-03 09:41',
    );
  });

  it('is case-insensitive and tolerates inner whitespace', () => {
    expect(fillTemplateVars('{{ Title }} {{DATE}} {{  time }}', vars)).toBe(
      'My Note 2026-07-03 09:41',
    );
  });

  it('replaces every occurrence', () => {
    expect(fillTemplateVars('{{title}} / {{title}}', vars)).toBe('My Note / My Note');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(fillTemplateVars('{{author}} {{title}}', vars)).toBe('{{author}} My Note');
  });

  it('returns the body unchanged when there are no variables', () => {
    expect(fillTemplateVars('plain body', vars)).toBe('plain body');
  });
});

describe('resolveTemplateFolder', () => {
  it('falls back to "templates" when blank/null/undefined', () => {
    expect(resolveTemplateFolder('')).toBe('templates');
    expect(resolveTemplateFolder('   ')).toBe('templates');
    expect(resolveTemplateFolder(null)).toBe('templates');
    expect(resolveTemplateFolder(undefined)).toBe('templates');
  });

  it('trims surrounding whitespace and slashes', () => {
    expect(resolveTemplateFolder('  Templates  ')).toBe('Templates');
    expect(resolveTemplateFolder('/meta/templates/')).toBe('meta/templates');
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(resolveTemplateFolder('meta\\templates')).toBe('meta/templates');
  });
});

describe('resolveNewNoteFolder', () => {
  it('is the vault root when location is "root"', () => {
    expect(resolveNewNoteFolder('root', 'ignored')).toBe('');
    expect(resolveNewNoteFolder('root', '')).toBe('');
  });

  it('returns the cleaned folder when location is "folder"', () => {
    expect(resolveNewNoteFolder('folder', 'Daily')).toBe('Daily');
    expect(resolveNewNoteFolder('folder', '/Journal/Daily/')).toBe('Journal/Daily');
  });

  it('is the vault root when "folder" is chosen but the path is blank', () => {
    expect(resolveNewNoteFolder('folder', '')).toBe('');
    expect(resolveNewNoteFolder('folder', '   ')).toBe('');
  });
});
