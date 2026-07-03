import { describe, expect, it } from 'vitest';
import { rewriteWikilinks } from './wikilinkRewrite';

/** Rewrite links whose written target (case-insensitively) matches `oldName`. */
const to = (newBase: string, oldName: string) => (text: string) =>
  rewriteWikilinks(text, {
    newBase,
    shouldRewrite: (t) => t.toLowerCase() === oldName.toLowerCase(),
  });

describe('rewriteWikilinks', () => {
  const rename = to('New', 'Old');

  it('rewrites a bare link', () => {
    expect(rename('see [[Old]] here')).toBe('see [[New]] here');
  });

  it('rewrites an embed, preserving the ! prefix', () => {
    expect(rename('![[Old]]')).toBe('![[New]]');
  });

  it('preserves #heading, #^block, and |alias suffixes', () => {
    expect(rename('[[Old#Intro]]')).toBe('[[New#Intro]]');
    expect(rename('[[Old#^abc123]]')).toBe('[[New#^abc123]]');
    expect(rename('[[Old|the alias]]')).toBe('[[New|the alias]]');
    expect(rename('[[Old#Intro|see intro]]')).toBe('[[New#Intro|see intro]]');
  });

  it('preserves a folder qualifier, swapping only the basename', () => {
    expect(rewriteWikilinks('[[Notes/Old]]', {
      newBase: 'New',
      shouldRewrite: (t) => t === 'Notes/Old',
    })).toBe('[[Notes/New]]');
  });

  it('preserves a written .md extension', () => {
    expect(rewriteWikilinks('[[Old.md]]', {
      newBase: 'New',
      shouldRewrite: (t) => t === 'Old.md',
    })).toBe('[[New.md]]');
  });

  it('rewrites regardless of the link target casing', () => {
    expect(rename('[[old]] and [[OLD#H]]')).toBe('[[New]] and [[New#H]]');
  });

  it('leaves fenced code blocks untouched', () => {
    const src = 'before [[Old]]\n```\ncode [[Old]] stays\n```\nafter [[Old]]';
    expect(rename(src)).toBe('before [[New]]\n```\ncode [[Old]] stays\n```\nafter [[New]]');
  });

  it('leaves inline code untouched', () => {
    expect(rename('real [[Old]] but `[[Old]]` is code')).toBe(
      'real [[New]] but `[[Old]]` is code',
    );
  });

  it('leaves non-matching links alone (respects the resolver decision)', () => {
    expect(rename('[[Other]] and [[Old]]')).toBe('[[Other]] and [[New]]');
  });

  it('does not touch empty self-heading targets', () => {
    expect(rename('[[#Section]]')).toBe('[[#Section]]');
  });

  it('is a no-op when nothing matches', () => {
    const src = 'plain text, no links, [[Different]]';
    expect(rename(src)).toBe(src);
  });

  it('rewrites multiple occurrences on one line', () => {
    expect(rename('[[Old]] then [[Old|x]] then [[Old#h]]')).toBe(
      '[[New]] then [[New|x]] then [[New#h]]',
    );
  });

  it('handles names containing spaces', () => {
    expect(rewriteWikilinks('link to [[My Note]] here', {
      newBase: 'Renamed Note',
      shouldRewrite: (t) => t === 'My Note',
    })).toBe('link to [[Renamed Note]] here');
  });
});
