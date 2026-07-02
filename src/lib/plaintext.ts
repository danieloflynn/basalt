/**
 * Reduce markdown to readable plain text for search excerpts and previews.
 * Keeps the words, drops the syntax: heading/list markers, emphasis, wikilink
 * brackets (alias wins), md links (text wins), embeds, highlights, comments.
 */
export function stripInlineMarkdown(src: string): string {
  return (
    src
      // %%comments%% vanish entirely
      .replace(/%%[\s\S]*?%%/g, ' ')
      // embeds and wikilinks: ![[target|alias]] / [[target|alias]] -> alias or target
      .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => {
        const label = alias ?? target;
        return label.split('/').pop() ?? label;
      })
      // images/links: keep the link text, drop the URL
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      // fenced code markers and inline backticks (content stays)
      .replace(/^(```|~~~)[^\n]*$/gm, ' ')
      .replace(/`([^`\n]*)`/g, '$1')
      // block syntax at line start: headings, quotes, list bullets, task boxes
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      // emphasis and highlights: **b** *i* __b__ _i_ ~~s~~ ==h==
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/==(.*?)==/g, '$1')
      // block ids and horizontal rules
      .replace(/\s\^[A-Za-z0-9-]+(?=\s|$)/g, ' ')
      .replace(/^(-{3,}|\*{3,}|_{3,})$/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
