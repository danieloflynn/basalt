import { Browser } from '@capacitor/browser';
import type { ComponentProps, ComponentType, ReactNode } from 'react';
import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useState } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import rehypeHighlight from 'rehype-highlight';
import rehypeReact from 'rehype-react';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { extractBlock, removeComments, slugifyHeading, stripBlockMarkers } from '@/lib/outline';
import {
  basename,
  dirname,
  isAudioPath,
  isHtmlPath,
  isMarkdownPath,
  isPdfPath,
  isVideoPath,
  normalizePath,
  noteTitle,
} from '@/lib/paths';
import { openFileExternally } from '@/engine';
import { vaultService } from '@/services';
import { openNote, useNav } from '@/state/nav';
import { ArtifactFrame } from '@/ui/components/ArtifactFrame';
import { IconCheck, IconImage, IconNote } from '@/ui/icons';
import {
  rehypeCallouts,
  rehypeHeadingAnchors,
  rehypeHoistEmbeds,
  rehypeSpecialBlocks,
  rehypeTasks,
} from './rehypePlugins';
import {
  remarkDropFrontmatter,
  remarkObsidian,
  remarkPromoteDisplayMath,
} from './remarkObsidian';

const MathBlock = lazy(() => import('./MathBlock'));
const MermaidBlock = lazy(() => import('./MermaidBlock'));

interface MarkdownContextValue {
  /** Vault path of the note being rendered (link resolution origin). */
  path: string;
  /** Transclusion depth — embeds beyond 2 render as plain links. */
  depth: number;
  /** Toggle a task checkbox at a 1-based source line. */
  onToggleTask?: (line: number) => void;
}

const MarkdownContext = createContext<MarkdownContextValue>({ path: '', depth: 0 });

/**
 * An unresolved target is creatable when it names a markdown note — not an
 * attachment ([[photo.png]]) and not a heading-only link ([[#h]], empty target).
 * Folder-qualified targets create at that vault path (Obsidian).
 */
function isCreatableTarget(target: string): boolean {
  const name = basename(normalizePath(target.trim()));
  return name !== '' && (!/\.[a-z0-9]+$/i.test(name) || /\.md$/i.test(name));
}

// Obsidian: tapping an unresolved [[link]] creates the note and opens the editor.
let creatingFromLink = false;
async function createNoteFromLink(target: string): Promise<void> {
  if (creatingFromLink) return; // double-tap guard
  creatingFromLink = true;
  try {
    const cleaned = normalizePath(target.trim()).replace(/\.md$/i, '');
    const path = await vaultService.createNote(dirname(cleaned), basename(cleaned));
    useNav.getState().push({ name: 'edit', path });
  } finally {
    creatingFromLink = false;
  }
}

// ---------------------------------------------------------------------------
// Custom element renderers
// ---------------------------------------------------------------------------

function SmartAnchor(props: ComponentProps<'a'>) {
  const ctx = useContext(MarkdownContext);
  const dataset = props as Record<string, unknown>;
  const target = dataset['data-target'] as string | undefined;
  const tag = dataset['data-tag'] as string | undefined;
  const embed = dataset['data-embed'] as string | undefined;
  const media = dataset['data-media'] as string | undefined;
  const heading = dataset['data-heading'] as string | undefined;
  const block = dataset['data-block'] as string | undefined;

  if (media && target) {
    return <MediaEmbed target={target} />;
  }

  if (embed && target !== undefined) {
    return <NoteEmbed target={target} heading={heading} block={block} />;
  }

  if (tag) {
    return (
      <a
        {...anchorProps(props)}
        className="tag"
        onClick={(e) => {
          e.preventDefault();
          useNav.getState().seedSearch(`tag:${tag}`);
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
          if (!resolved) {
            if (isCreatableTarget(target)) void createNoteFromLink(target);
            return;
          }
          if (!isMarkdownPath(resolved)) {
            if (isHtmlPath(resolved)) {
              useNav.getState().push({ name: 'artifact', path: resolved });
            }
            return;
          }
          if (resolved === ctx.path && heading) {
            scrollToHeading(heading);
          } else {
            openNote(resolved, heading);
          }
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
        if (!resolved) return;
        if (isMarkdownPath(resolved)) openNote(resolved);
        else if (isHtmlPath(resolved)) {
          useNav.getState().push({ name: 'artifact', path: resolved });
        }
      }}
    >
      {props.children}
    </a>
  );
}

export function scrollToHeading(heading: string): void {
  const el = document.getElementById(slugifyHeading(heading));
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function anchorProps(props: ComponentProps<'a'>): ComponentProps<'a'> {
  const { children: _children, ...rest } = props;
  // '' comes from remark link nodes with no url; React warns on empty href.
  return { ...rest, href: props.href || '#' };
}

function VaultImage(props: ComponentProps<'img'>) {
  const ctx = useContext(MarkdownContext);
  const dataset = props as Record<string, unknown>;
  const vaultSrc = dataset['data-vault-src'] as string | undefined;
  const raw = vaultSrc ?? props.src ?? '';
  const remote = /^https?:\/\//i.test(String(raw));
  const [src, setSrc] = useState<string | null>(remote ? String(raw) : null);
  const [failed, setFailed] = useState(false);

  // Obsidian's `![alt|300](url)` sizing for standard image syntax.
  let alt = props.alt ?? '';
  let width = props.width;
  let height = props.height;
  const sizeInAlt = /^(.*)\|(\d+)(?:x(\d+))?$/.exec(alt);
  if (sizeInAlt) {
    alt = sizeInAlt[1];
    width = Number(sizeInAlt[2]);
    if (sizeInAlt[3]) height = Number(sizeInAlt[3]);
  }

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
  return (
    <img src={src} alt={alt} width={width} height={height} loading="lazy" onError={() => setFailed(true)} />
  );
}

/**
 * ![[file.mp3]] / ![[clip.mp4]] inline players; ![[doc.pdf]] opens externally;
 * ![[page.html]] renders a sandboxed artifact frame.
 */
function MediaEmbed({ target }: { target: string }) {
  const ctx = useContext(MarkdownContext);
  const resolved = vaultService.resolveLink(target, ctx.path);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!resolved || isHtmlPath(resolved)) return;
    vaultService.fileUrl(resolved).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [resolved]);

  if (!resolved) {
    return (
      <span className="embed embed--broken" style={{ display: 'block' }}>
        Missing file: {target}
      </span>
    );
  }

  if (isHtmlPath(resolved)) {
    return <HtmlEmbed path={resolved} />;
  }

  if (isAudioPath(resolved)) {
    return url ? (
      <audio controls src={url} style={{ width: '100%', display: 'block' }} />
    ) : (
      <span className="embed" style={{ display: 'block', minHeight: 40 }} />
    );
  }
  if (isVideoPath(resolved)) {
    return url ? (
      <video controls src={url} playsInline style={{ width: '100%', display: 'block', borderRadius: 8 }} />
    ) : (
      <span className="embed" style={{ display: 'block', minHeight: 40 }} />
    );
  }
  if (isPdfPath(resolved)) {
    return (
      <button
        type="button"
        className="embed"
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left' }}
        onClick={() => void openFileExternally(resolved)}
      >
        <IconNote size={18} />
        <span>
          <span style={{ display: 'block', fontWeight: 600 }}>{target}</span>
          <span style={{ display: 'block', fontSize: '0.8em', color: 'var(--text-faint)' }}>
            Open PDF
          </span>
        </span>
      </button>
    );
  }
  return null;
}

/** ![[page.html]] — the artifact inline, sandboxed, with a jump to the full viewer. */
function HtmlEmbed({ path }: { path: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const title = noteTitle(path);

  useEffect(() => {
    let cancelled = false;
    vaultService
      .readNote(path)
      .then((t) => {
        if (!cancelled) setHtml(t);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (failed) {
    return (
      <span className="embed embed--broken" style={{ display: 'block' }}>
        Missing file: {path}
      </span>
    );
  }
  return (
    <span className="embed embed--artifact" style={{ display: 'block' }}>
      <span className="embed__title embed__title--artifact">
        {title}
        <button
          type="button"
          className="embed__open"
          onClick={() => useNav.getState().push({ name: 'artifact', path })}
        >
          Open
        </button>
      </span>
      {html === null ? (
        <span className="artifact-frame--embed" style={{ display: 'block' }} />
      ) : (
        <ArtifactFrame path={path} html={html} className="artifact-frame--embed" />
      )}
    </span>
  );
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

/** ![[Note]] transclusion — whole note, one #section, or one ^block. */
function NoteEmbed({ target, heading, block }: { target: string; heading?: string; block?: string }) {
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
    // Genuinely unresolved markdown target: tap to create it (read failures
    // and non-markdown targets stay inert).
    if (!resolved && isCreatableTarget(target)) {
      return (
        <button
          type="button"
          className="embed embed--broken"
          style={{ display: 'block', width: '100%', textAlign: 'left' }}
          onClick={() => void createNoteFromLink(target)}
        >
          Missing note: {target}
        </button>
      );
    }
    return (
      <span className="embed embed--broken" style={{ display: 'block' }}>
        {failed || !resolved ? `Missing note: ${target}` : `[[${target}]]`}
      </span>
    );
  }
  if (text === null) {
    return <span className="embed" style={{ display: 'block', minHeight: 40 }} />;
  }

  const section = block
    ? (extractBlock(text, block) ?? text)
    : heading
      ? extractSection(text, heading)
      : text;
  const label = heading ? ` › ${heading}` : '';
  return (
    <span className="embed" style={{ display: 'block' }}>
      <span className="embed__title" style={{ display: 'block' }}>
        {target || 'This note'}
        {label}
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

function MathInline({ children }: { children?: ReactNode }) {
  return (
    <Suspense fallback={<code>{children}</code>}>
      <MathBlock tex={String(children ?? '')} display={false} />
    </Suspense>
  );
}

function MathDisplay({ children }: { children?: ReactNode }) {
  return (
    <Suspense fallback={<code>{children}</code>}>
      <MathBlock tex={String(children ?? '')} display />
    </Suspense>
  );
}

function MermaidTag({ children }: { children?: ReactNode }) {
  return (
    <Suspense fallback={<span className="embed" style={{ display: 'block', minHeight: 60 }} />}>
      <MermaidBlock source={String(children ?? '')} />
    </Suspense>
  );
}

const components = {
  a: SmartAnchor,
  img: VaultImage,
  button: TaskBox,
  'math-inline': MathInline,
  'math-display': MathDisplay,
  'mermaid-block': MermaidTag,
} as unknown as Record<string, ComponentType<Record<string, unknown>>>;

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath, { singleDollarTextMath: true })
  .use(remarkPromoteDisplayMath)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkDropFrontmatter)
  .use(remarkObsidian)
  .use(remarkRehype)
  .use(rehypeTasks)
  .use(rehypeHoistEmbeds)
  .use(rehypeCallouts)
  .use(rehypeHeadingAnchors)
  .use(rehypeSpecialBlocks)
  .use(rehypeHighlight, { detect: false })
  .use(rehypeReact, {
    Fragment,
    jsx,
    jsxs,
    components: components as never,
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
      return processor.processSync(stripBlockMarkers(removeComments(source))).result;
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
