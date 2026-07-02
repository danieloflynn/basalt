import type { Element, ElementContent, Root, Text } from 'hast';
import { visit } from 'unist-util-visit';

const CALLOUT_PATTERN = /^\[!([a-zA-Z]+)\][+-]?\s?/;

/**
 * Obsidian callouts: a blockquote whose first paragraph starts with [!kind]
 * becomes <div class="callout" data-kind> with a styled header (R-6).
 */
export function rehypeCallouts() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'blockquote') return;
      const firstPara = node.children.find(
        (c): c is Element => c.type === 'element' && c.tagName === 'p',
      );
      const firstText = firstPara?.children[0];
      if (!firstPara || !firstText || firstText.type !== 'text') return;
      const match = CALLOUT_PATTERN.exec(firstText.value);
      if (!match) return;

      const kind = match[1].toLowerCase();
      firstText.value = firstText.value.slice(match[0].length);

      // Title = remainder of the first line; body = everything else.
      const newline = firstText.value.indexOf('\n');
      let titleText = firstText.value;
      if (newline !== -1) {
        titleText = firstText.value.slice(0, newline);
        firstText.value = firstText.value.slice(newline + 1);
      } else {
        firstPara.children.shift();
      }
      const title = titleText.trim() || kind.charAt(0).toUpperCase() + kind.slice(1);

      const head: Element = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['callout__head'] },
        children: [{ type: 'text', value: title } satisfies Text],
      };
      const body: Element = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['callout__body'] },
        children: node.children.filter(
          (c) => !(c === firstPara && paraIsEmpty(firstPara)),
        ) as ElementContent[],
      };

      node.tagName = 'div';
      node.properties = { className: ['callout'], 'data-kind': kind };
      node.children = [head, body];
    });
  };
}

function paraIsEmpty(p: Element): boolean {
  return p.children.every((c) => c.type === 'text' && c.value.trim() === '');
}

/**
 * GFM task list items -> tappable tasks. Adds the source line number so a tap
 * can toggle the exact checkbox in the underlying markdown (E-6).
 */
export function rehypeTasks() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'li') return;
      const input = node.children.find(
        (c): c is Element =>
          c.type === 'element' && c.tagName === 'input' &&
          (c.properties?.type === 'checkbox' || c.properties?.type === undefined),
      );
      if (!input || input.tagName !== 'input') return;

      const checked = Boolean(input.properties?.checked);
      const line = node.position?.start.line;
      node.properties = {
        ...node.properties,
        className: ['task'],
        'data-checked': String(checked),
      };

      const rest = node.children.filter((c) => c !== input);
      node.children = [
        {
          type: 'element',
          tagName: 'button',
          properties: {
            className: ['task__box'],
            'data-line': line,
            'data-checked': String(checked),
            'aria-label': checked ? 'Mark as not done' : 'Mark as done',
          },
          children: [],
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['task__body'] },
          children: rest as ElementContent[],
        },
      ];
    });
  };
}
