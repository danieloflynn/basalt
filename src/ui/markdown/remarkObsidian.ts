import type { Parent, PhrasingContent, Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';
import { isAudioPath, isImagePath, isPdfPath, isVideoPath } from '@/lib/paths';
import { parseWikilinkInner, wikilinkDisplayText } from '@/lib/wikilinks';

const TOKEN =
  /(!)?\[\[([^\[\]]+?)\]\]|==([^=\n][^\n]*?)==|(^|[\s(])#([A-Za-z0-9_/-]*[A-Za-z_/-][A-Za-z0-9_/-]*)/g;

/** `![[img.png|300]]` or `|300x200` sizing. */
const SIZE_ALIAS = /^(\d+)(?:x(\d+))?$/;

/**
 * Turns Obsidian syntax inside text nodes into typed inline nodes:
 *   [[Note]]        -> <a class="wikilink" data-target="Note">
 *   ![[Note]]       -> <a data-embed data-target="Note">  (transclusion)
 *   ![[img.png]]    -> <img data-vault-src="img.png">
 *   ![[song.mp3]]   -> <a data-media data-target>          (audio/video/pdf)
 *   ==highlight==   -> <mark>
 *   #tag            -> <a class="tag" data-tag="tag">
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
        const [raw, bang, inner, highlight, tagPre, tag] = match;
        let start = match.index;

        if (tag !== undefined) {
          start += tagPre.length;
          if (start > last) out.push({ type: 'text', value: value.slice(last, start) });
          out.push(inlineNode(`#${tag}`, { className: ['tag'], 'data-tag': tag }));
          last = start + 1 + tag.length;
          continue;
        }

        if (start > last) out.push({ type: 'text', value: value.slice(last, start) });

        if (highlight !== undefined) {
          out.push(inlineNode(highlight, {}, 'mark'));
          last = start + raw.length;
          continue;
        }

        const link = parseWikilinkInner(inner);
        const display = wikilinkDisplayText(link);

        if (bang && isImagePath(link.target)) {
          const size = link.alias ? SIZE_ALIAS.exec(link.alias) : null;
          out.push({
            type: 'image',
            url: '',
            alt: size ? link.target : (link.alias ?? link.target),
            data: {
              hProperties: {
                'data-vault-src': link.target,
                width: size ? size[1] : undefined,
                height: size?.[2] ?? undefined,
              },
            },
          });
        } else if (bang && (isAudioPath(link.target) || isVideoPath(link.target) || isPdfPath(link.target))) {
          out.push(
            inlineNode(display, {
              'data-media': 'true',
              'data-target': link.target,
            }),
          );
        } else if (bang) {
          out.push(
            inlineNode(display, {
              'data-embed': 'true',
              'data-target': link.target,
              'data-heading': link.heading ?? undefined,
              'data-block': link.blockRef ?? undefined,
            }),
          );
        } else {
          out.push(
            inlineNode(display, {
              className: ['wikilink'],
              'data-target': link.target,
              'data-heading': link.heading ?? undefined,
              'data-block': link.blockRef ?? undefined,
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

function inlineNode(
  text: string,
  hProperties: Record<string, unknown>,
  hName?: string,
): PhrasingContent {
  return {
    type: 'link',
    url: '',
    data: { ...(hName ? { hName } : {}), hProperties },
    children: [{ type: 'text', value: text }],
  } as PhrasingContent;
}

/** Removes the parsed YAML node so frontmatter never renders as content. */
export function remarkDropFrontmatter() {
  return (tree: Root) => {
    tree.children = tree.children.filter((n) => n.type !== ('yaml' as typeof n.type));
  };
}
