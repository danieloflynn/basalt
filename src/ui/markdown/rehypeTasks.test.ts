import type { Element, Root } from 'hast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';
import { rehypeTasks } from './rehypePlugins';

function render(src: string): Root {
  const p = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeTasks);
  return p.runSync(p.parse(src)) as Root;
}

function collect(tree: Root, tagName: string): Element[] {
  const out: Element[] = [];
  visit(tree, 'element', (node: Element) => {
    if (node.tagName === tagName) out.push(node);
  });
  return out;
}

const classesOf = (el: Element): string[] =>
  Array.isArray(el.properties?.className) ? el.properties.className.map(String) : [];

describe('rehypeTasks', () => {
  it('converts tight task items: li.task with a button box, no raw input', () => {
    const tree = render('- [ ] one\n- [x] two');
    const items = collect(tree, 'li');
    expect(items).toHaveLength(2);
    expect(items.every((li) => classesOf(li).includes('task'))).toBe(true);
    expect(collect(tree, 'input')).toHaveLength(0);
    const boxes = collect(tree, 'button');
    expect(boxes).toHaveLength(2);
    expect(boxes[1].properties?.['data-checked']).toBe('true');
    expect(boxes[1].properties?.['data-line']).toBe(2);
  });

  it('converts LOOSE task items (checkbox wrapped in <p>) the same way', () => {
    const tree = render('- [ ] one\n\n- [x] two');
    const items = collect(tree, 'li');
    expect(items).toHaveLength(2);
    // The regression: these kept their bullet (no .task class) and rendered
    // the raw disabled checkbox next to it.
    expect(items.every((li) => classesOf(li).includes('task'))).toBe(true);
    expect(collect(tree, 'input')).toHaveLength(0);
    expect(collect(tree, 'button')).toHaveLength(2);
    // data-line still maps to the item's source line for toggling.
    const boxes = collect(tree, 'button');
    expect(boxes[0].properties?.['data-line']).toBe(1);
    expect(boxes[1].properties?.['data-line']).toBe(3);
  });

  it('wraps the item content in a div body (loose bodies hold <p> flow content)', () => {
    const tree = render('- [ ] one\n\n- [x] two');
    for (const li of collect(tree, 'li')) {
      const body = li.children.find(
        (c): c is Element => c.type === 'element' && c.tagName === 'div',
      );
      expect(body && classesOf(body).includes('task__body')).toBe(true);
    }
  });

  it('leaves plain list items alone', () => {
    const tree = render('- plain\n\n- also plain');
    expect(collect(tree, 'button')).toHaveLength(0);
    expect(collect(tree, 'li').some((li) => classesOf(li).includes('task'))).toBe(false);
  });

  it('does not steal a checkbox from a nested sublist', () => {
    const tree = render('- parent\n  - [ ] child');
    const items = collect(tree, 'li');
    const tasks = items.filter((li) => classesOf(li).includes('task'));
    expect(tasks).toHaveLength(1);
    expect(collect(tree, 'button')).toHaveLength(1);
  });
});
