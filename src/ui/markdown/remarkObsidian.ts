import type { Parent, PhrasingContent, Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';
import { isImagePath } from '@/lib/paths';
import { parseWikilinkInner, wikilinkDisplayText } from '@/lib/wikilinks';

const TOKEN = /(!)?\[\[([^\[\]]+?)\]\]|(^|[\s(])#([A-Za-z0-9_/-]*[A-Za-z_/-][A-Za-z0-9_/-]*)/g;

/**
 * Turns Obsidian syntax inside text nodes into typed inline nodes:
 *   [[Note]]      -> <a class="wikilink" data-target="Note">
 *   ![[Note]]     -> <a data-embed data-target="Note">   (component renders transclusion)
 *   ![[img.png]]  -> <img data-vault-src="img.png">
 *   #tag          -> <a class="tag" data-tag="tag">
 */
export function remarkObsidian() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return;
      if (parent.type === 'link' || parent.type === 'linkReference') return;

      const value = node.value;
      TOKEN.lastIndex = 0;
      let match: RegExpExecArray | null;
      let last = 0;
      const out: PhrasingContent[] = [];

      while ((match = TOKEN.exec(value))) {
        const [raw, bang, inner, tagPre, tag] = match;
        let start = match.index;

        if (tag !== undefined) {
          // Leading whitespace/paren stays plain text.
          start += tagPre.length;
          if (start > last) out.push({ type: 'text', value: value.slice(last, start) });
          out.push(inlineNode(`#${tag}`, { className: ['tag'], 'data-tag': tag }));
          last = start + 1 + tag.length;
          continue;
        }

        if (start > last) out.push({ type: 'text', value: value.slice(last, start) });
        const link = parseWikilinkInner(inner);
        const display = wikilinkDisplayText(link);

        if (bang && isImagePath(link.target)) {
          out.push({
            type: 'image',
            url: '',
            alt: link.alias ?? link.target,
            data: { hProperties: { 'data-vault-src': link.target } },
          });
        } else if (bang) {
          out.push(
            inlineNode(display, {
              'data-embed': 'true',
              'data-target': link.target,
              'data-heading': link.heading ?? undefined,
            }),
          );
        } else {
          out.push(
            inlineNode(display, {
              className: ['wikilink'],
              'data-target': link.target,
              'data-heading': link.heading ?? undefined,
            }),
          );
        }
        last = start + raw.length;
      }

      if (out.length === 0) return;
      if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
      (parent as Parent).children.splice(index, 1, ...out);
      return index + out.length;
    });
  };
}

function inlineNode(text: string, hProperties: Record<string, unknown>): PhrasingContent {
  return {
    type: 'link',
    url: '',
    data: { hProperties },
    children: [{ type: 'text', value: text }],
  } as PhrasingContent;
}

/** Removes the parsed YAML node so frontmatter never renders as content. */
export function remarkDropFrontmatter() {
  return (tree: Root) => {
    tree.children = tree.children.filter((n) => n.type !== ('yaml' as typeof n.type));
  };
}
