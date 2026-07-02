import { Browser } from '@capacitor/browser';
import type { ComponentProps, ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import rehypeHighlight from 'rehype-highlight';
import rehypeReact from 'rehype-react';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { isMarkdownPath } from '@/lib/paths';
import { vaultService } from '@/services';
import { openNote, useNav } from '@/state/nav';
import { IconCheck, IconImage } from '@/ui/icons';
import { rehypeCallouts, rehypeTasks } from './rehypePlugins';
import { remarkDropFrontmatter, remarkObsidian } from './remarkObsidian';

interface MarkdownContextValue {
  /** Vault path of the note being rendered (link resolution origin). */
  path: string;
  /** Transclusion depth — embeds beyond 2 render as plain links. */
  depth: number;
  /** Toggle a task checkbox at a 1-based source line. */
  onToggleTask?: (line: number) => void;
}

const MarkdownContext = createContext<MarkdownContextValue>({ path: '', depth: 0 });

// ---------------------------------------------------------------------------
// Custom element renderers
// ---------------------------------------------------------------------------

function SmartAnchor(props: ComponentProps<'a'>) {
  const ctx = useContext(MarkdownContext);
  const dataset = props as Record<string, unknown>;
  const target = dataset['data-target'] as string | undefined;
  const tag = dataset['data-tag'] as string | undefined;
  const embed = dataset['data-embed'] as string | undefined;
  const heading = dataset['data-heading'] as string | undefined;

  if (embed && target) {
    return <NoteEmbed target={target} heading={heading} />;
  }

  if (tag) {
    return (
      <a
        {...anchorProps(props)}
        className="tag"
        onClick={(e) => {
          e.preventDefault();
          useNav.getState().push({ name: 'search', initialQuery: `#${tag}` });
        }}
      >
        {props.children}
      </a>
    );
  }

  if (target !== undefined) {
    const resolved = vaultService.resolveLink(target, ctx.path);
    return (
      <a
        {...anchorProps(props)}
        className={resolved ? 'wikilink' : 'wikilink wikilink--unresolved'}
        onClick={(e) => {
          e.preventDefault();
          if (resolved && isMarkdownPath(resolved)) openNote(resolved);
        }}
      >
        {props.children}
      </a>
    );
  }

  // Standard markdown link.
  const href = props.href ?? '';
  const external = /^[a-z][a-z0-9+.-]*:/i.test(href);
  return (
    <a
      {...anchorProps(props)}
      onClick={(e) => {
        e.preventDefault();
        if (external) {
          void Browser.open({ url: href });
          return;
        }
        const resolved = vaultService.resolveLink(decodeURIComponent(href), ctx.path);
        if (resolved && isMarkdownPath(resolved)) openNote(resolved);
      }}
    >
      {props.children}
    </a>
  );
}

function anchorProps(props: ComponentProps<'a'>): ComponentProps<'a'> {
  const { children: _children, ...rest } = props;
  return { ...rest, href: props.href ?? '#' };
}

function VaultImage(props: ComponentProps<'img'>) {
  const ctx = useContext(MarkdownContext);
  const dataset = props as Record<string, unknown>;
  const vaultSrc = dataset['data-vault-src'] as string | undefined;
  const raw = vaultSrc ?? props.src ?? '';
  const remote = /^https?:\/\//i.test(String(raw));
  const [src, setSrc] = useState<string | null>(remote ? String(raw) : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (remote) return;
    let cancelled = false;
    const resolved = vaultService.resolveLink(decodeURIComponent(String(raw)), ctx.path);
    if (!resolved) {
      setFailed(true);
      return;
    }
    vaultService
      .fileUrl(resolved)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [raw, remote, ctx.path]);

  if (failed) {
    return (
      <span className="embed embed--broken" style={{ display: 'block' }}>
        <IconImage size={16} /> Missing image: {String(raw)}
      </span>
    );
  }
  if (!src) return <span className="embed" style={{ display: 'block', minHeight: 40 }} />;
  return <img src={src} alt={props.alt ?? ''} loading="lazy" onError={() => setFailed(true)} />;
}

function TaskBox(props: ComponentProps<'button'>) {
  const ctx = useContext(MarkdownContext);
  const dataset = props as Record<string, unknown>;
  const line = Number(dataset['data-line']);
  const checked = dataset['data-checked'] === 'true';
  return (
    <button
      type="button"
      className="task__box"
      aria-label={checked ? 'Mark as not done' : 'Mark as done'}
      onClick={() => {
        if (Number.isFinite(line)) ctx.onToggleTask?.(line);
      }}
    >
      <IconCheck size={14} strokeWidth={3} />
    </button>
  );
}

/** ![[Note]] transclusion — renders the target note inline, one section if a heading is given. */
function NoteEmbed({ target, heading }: { target: string; heading?: string }) {
  const ctx = useContext(MarkdownContext);
  const resolved = vaultService.resolveLink(target, ctx.path);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!resolved || !isMarkdownPath(resolved)) {
      setFailed(true);
      return;
    }
    vaultService
      .readNote(resolved)
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [resolved]);

  if (ctx.depth >= 2 || failed || !resolved) {
    return (
      <span className="embed embed--broken" style={{ display: 'block' }}>
        {failed || !resolved ? `Missing note: ${target}` : `[[${target}]]`}
      </span>
    );
  }
  if (text === null) {
    return <span className="embed" style={{ display: 'block', minHeight: 40 }} />;
  }

  const section = heading ? extractSection(text, heading) : text;
  return (
    <span className="embed" style={{ display: 'block' }}>
      <span className="embed__title" style={{ display: 'block' }}>
        {target}
        {heading ? ` › ${heading}` : ''}
      </span>
      <Markdown source={section} path={resolved} depth={ctx.depth + 1} />
    </span>
  );
}

/** Slice out one heading's section (until the next heading of equal or higher level). */
export function extractSection(source: string, heading: string): string {
  const lines = source.split('\n');
  const wanted = heading.trim().toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (!m) continue;
    if (start === -1 && m[2].trim().toLowerCase() === wanted) {
      start = i;
      level = m[1].length;
    } else if (start !== -1 && m[1].length <= level) {
      return lines.slice(start, i).join('\n');
    }
  }
  return start === -1 ? source : lines.slice(start).join('\n');
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkDropFrontmatter)
  .use(remarkObsidian)
  .use(remarkRehype)
  .use(rehypeTasks)
  .use(rehypeCallouts)
  .use(rehypeHighlight, { detect: false })
  .use(rehypeReact, {
    Fragment,
    jsx,
    jsxs,
    components: {
      a: SmartAnchor,
      img: VaultImage,
      button: TaskBox,
    },
  });

export interface MarkdownProps {
  source: string;
  path: string;
  depth?: number;
  onToggleTask?: (line: number) => void;
}

export function Markdown({ source, path, depth = 0, onToggleTask }: MarkdownProps) {
  const ctx = useMemo(() => ({ path, depth, onToggleTask }), [path, depth, onToggleTask]);
  const content = useMemo<ReactNode>(() => {
    try {
      return processor.processSync(source).result;
    } catch {
      return <pre>{source}</pre>;
    }
  }, [source]);

  return (
    <MarkdownContext.Provider value={ctx}>
      <div className={depth === 0 ? 'md' : 'md md--embed'}>{content}</div>
    </MarkdownContext.Provider>
  );
}
