import type { Element, ElementContent, Root, Text } from 'hast';
import { visit } from 'unist-util-visit';
import { slugifyHeading } from '@/lib/outline';

const CALLOUT_PATTERN = /^\[!([a-zA-Z]+)\]([+-])?\s?/;

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
      const fold = match[2]; // '-' folded, '+' expanded, undefined = plain
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

      const foldable = fold === '-' || fold === '+';
      const head: Element = {
        type: 'element',
        tagName: foldable ? 'summary' : 'div',
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

      node.tagName = foldable ? 'details' : 'div';
      node.properties = {
        className: ['callout'],
        'data-kind': kind,
        ...(fold === '+' ? { open: true } : {}),
      };
      node.children = [head, body];
    });
  };
}

/** Give headings stable ids so [[Note#Heading]] can scroll to them. */
export function rehypeHeadingAnchors() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (!/^h[1-6]$/.test(node.tagName)) return;
      const text = collectText(node);
      if (text) node.properties = { ...node.properties, id: slugifyHeading(text) };
    });
  };
}

function collectText(node: Element): string {
  let out = '';
  visit(node, 'text', (t: Text) => {
    out += t.value;
  });
  return out;
}

/**
 * Note transclusions (a[data-embed]) render as block-level cards containing a
 * nested <Markdown> full of <p>/<h*> children — invalid inside the host
 * paragraph (React flags div-in-p and p-in-p on every embed). Hoist them out:
 * a <p> containing note embeds is split into paragraph segments with the
 * embeds as block siblings. Media embeds (data-media, img) stay inline.
 */
export function rehypeHoistEmbeds() {
  const isNoteEmbed = (c: ElementContent): c is Element =>
    c.type === 'element' && c.tagName === 'a' && c.properties?.['data-embed'] === 'true';
  const isBlankText = (c: ElementContent): boolean =>
    c.type === 'text' && (c as Text).value.trim() === '';

  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'p' || index === undefined || !parent) return;
      if (!node.children.some(isNoteEmbed)) return;

      const out: ElementContent[] = [];
      let run: ElementContent[] = [];
      const flush = () => {
        if (run.length && !run.every(isBlankText)) {
          out.push({ ...node, children: run });
        }
        run = [];
      };
      for (const child of node.children) {
        if (isNoteEmbed(child)) {
          flush();
          out.push(child);
        } else {
          run.push(child);
        }
      }
      flush();
      parent.children.splice(index, 1, ...out);
      // Re-visit the replacement position (embeds themselves have no <p> kids).
      return index;
    });
  };
}

/**
 * Rewrites remark-math output and mermaid code fences into custom elements
 * that rehype-react maps to lazy-loaded components:
 *   code.math-inline          -> <math-inline>tex</math-inline>
 *   pre > code.math-display   -> <math-display>tex</math-display>
 *   pre > code.language-mermaid -> <mermaid-block>src</mermaid-block>
 */
export function rehypeSpecialBlocks() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (index === undefined || !parent) return;
      const target = codeChildOrSelf(node);
      if (!target) return;
      const classes = classList(target);
      let tagName: string | null = null;
      if (classes.includes('language-mermaid')) tagName = 'mermaid-block';
      else if (classes.includes('math-display')) tagName = 'math-display';
      else if (classes.includes('math-inline')) tagName = 'math-inline';
      if (!tagName) return;
      // Inline math must stay inline: only accept bare <code> for math-inline.
      if (tagName === 'math-inline' && node.tagName === 'pre') tagName = 'math-display';

      const replacement: Element = {
        type: 'element',
        tagName,
        properties: {},
        children: [{ type: 'text', value: collectText(target) } satisfies Text],
      };
      (parent as Element).children[index] = replacement;
    });
  };
}

function codeChildOrSelf(node: Element): Element | null {
  if (node.tagName === 'code') return node;
  if (node.tagName === 'pre') {
    const code = node.children.find(
      (c): c is Element => c.type === 'element' && c.tagName === 'code',
    );
    return code ?? null;
  }
  return null;
}

function classList(node: Element): string[] {
  const cls = node.properties?.className;
  return Array.isArray(cls) ? cls.map(String) : typeof cls === 'string' ? cls.split(' ') : [];
}

function paraIsEmpty(p: Element): boolean {
  return p.children.every((c) => c.type === 'text' && c.value.trim() === '');
}

/**
 * GFM task list items -> tappable tasks. Adds the source line number so a tap
 * can toggle the exact checkbox in the underlying markdown (E-6).
 */
export function rehypeTasks() {
  const findCheckbox = (host: Element): Element | undefined =>
    host.children.find(
      (c): c is Element =>
        c.type === 'element' && c.tagName === 'input' &&
        (c.properties?.type === 'checkbox' || c.properties?.type === undefined),
    );

  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'li') return;
      // Tight list: the checkbox is a direct child. Loose list (blank lines
      // between items): remark-rehype wraps the item in a <p>, so look inside
      // the li's first element child too — without this the item kept its
      // bullet AND rendered the raw disabled checkbox.
      let input = findCheckbox(node);
      if (!input) {
        const firstEl = node.children.find((c): c is Element => c.type === 'element');
        if (firstEl?.tagName === 'p') {
          input = findCheckbox(firstEl);
          if (input) firstEl.children = firstEl.children.filter((c) => c !== input);
        }
      }
      if (!input) return;

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
          // div, not span: loose-list bodies hold <p> children (flow content).
          type: 'element',
          tagName: 'div',
          properties: { className: ['task__body'] },
          children: rest as ElementContent[],
        },
      ];
    });
  };
}
