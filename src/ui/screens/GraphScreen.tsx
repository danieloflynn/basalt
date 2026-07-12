import { useEffect, useRef, useState } from 'react';
import { noteTitle } from '@/lib/paths';
import { useSettings } from '@/services';
import { useNav } from '@/state/nav';
import {
  filterGroupSignature,
  mergeGraphConfig,
  type GraphConfig,
} from '@/ui/graph/config';
import { gatherGraphInput } from '@/ui/graph/data';
import {
  buildGraphModel,
  timelapseOrder,
  timelapseSlice,
  type GraphModel,
  type NodeKind,
} from '@/ui/graph/model';
import { GraphPanel } from '@/ui/graph/GraphPanel';
import { IconBack, IconSettings, IconWand } from '@/ui/icons';

interface Pos {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface SimNode {
  id: string;
  kind: NodeKind;
  label: string;
  path?: string;
  color?: string;
  mtimeMs: number;
  degree: number;
  pos: Pos;
}

/** Imperative handle the React layer uses to push config / drive the timelapse. */
interface GraphController {
  setConfig: (cfg: GraphConfig) => void;
  animate: () => void;
  startTimelapse: () => void;
  stopTimelapse: () => void;
}

interface GraphDebug {
  count: () => number;
  nodes: () => Array<{ id: string; kind: NodeKind; x: number; y: number }>;
  screen: (id: string) => { x: number; y: number } | null;
  timelapsing: () => boolean;
}

declare global {
  interface Window {
    __graphDebug?: GraphDebug;
  }
}

/** Force-directed graph of the vault (or a note's neighborhood). Tap a node to open it. */
export function GraphScreen({ path }: { path?: string }) {
  const nav = useNav();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<GraphController | null>(null);

  const [config, setConfig] = useState<GraphConfig>(() =>
    mergeGraphConfig(useSettings.getState().settings.graph),
  );
  const [panelOpen, setPanelOpen] = useState(false);
  const [wandActive, setWandActive] = useState(false);
  const configRef = useRef(config);
  configRef.current = config;

  // Reset transient UI when navigating between global/local graph.
  useEffect(() => {
    setPanelOpen(false);
    setWandActive(false);
  }, [path]);

  // Persist the whole config under the single `graph` settings key (debounced
  // so slider drags don't hammer storage).
  useEffect(() => {
    const t = setTimeout(() => void useSettings.getState().update({ graph: config }), 250);
    return () => clearTimeout(t);
  }, [config]);

  // Push live config into the running sim (rebuilds only when the node set changes).
  useEffect(() => {
    controllerRef.current?.setConfig(config);
  }, [config]);

  // Wand: start/stop the timelapse.
  useEffect(() => {
    if (wandActive) controllerRef.current?.startTimelapse();
    else controllerRef.current?.stopTimelapse();
  }, [wandActive]);

  // ---- Canvas + simulation (survives config changes; keyed only on `path`) ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const input = gatherGraphInput(path);
    let cfg = configRef.current;

    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;
    const colEdge = token('--border-strong', '#555');
    const colNode = token('--column-rock-lit', '#888');
    const colActive = token('--ember', '#e8764a');
    const colText = token('--text-muted', '#aaa');
    const colTag = token('--link', '#85b8a3');
    // Artifacts render in the link color (per the artifacts design) — same token
    // as tags/wikilinks; the node shape/size and filename label keep them apart.
    const colArtifact = token('--link', '#85b8a3');
    const colAttach = token('--text-faint', '#6f6b66');
    const colPhantom = token('--unresolved', '#8d8878');

    const rand = (seed: number) => {
      const x = Math.sin(seed * 999) * 10_000;
      return x - Math.floor(x);
    };

    // Persistent positions keyed by node id, so surviving nodes keep their place
    // across filter/group rebuilds (the graph doesn't rescramble).
    const positions = new Map<string, Pos>();
    const seedPos = (id: string, index: number): Pos => {
      const existing = positions.get(id);
      if (existing) return existing;
      // Index-based seed reproduces the original default layout exactly.
      const pos: Pos = {
        x: (rand(index + 1) - 0.5) * 600,
        y: (rand(index + 101) - 0.5) * 600,
        vx: 0,
        vy: 0,
      };
      positions.set(id, pos);
      return pos;
    };

    let nodes: SimNode[] = [];
    let links: Array<[SimNode, SimNode]> = [];
    let alpha = 1;
    let fullModel: GraphModel = { nodes: [], edges: [] };
    // The node currently held by a drag (declared up here — applyModel clears it
    // when a rebuild removes it, and the gesture handlers below assign it).
    let dragNode: SimNode | null = null;

    // Timelapse state.
    let timelapse = false;
    let revealed = 0;
    let order: string[] = [];
    let stepTimer = 0;

    const applyModel = (model: GraphModel) => {
      const degree = new Map<string, number>();
      for (const e of model.edges) {
        degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
        degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
      }
      const byId = new Map<string, SimNode>();
      nodes = model.nodes.map((mn, i) => {
        const node: SimNode = {
          id: mn.id,
          kind: mn.kind,
          label: mn.label,
          path: mn.path,
          color: mn.color,
          mtimeMs: mn.mtimeMs,
          degree: degree.get(mn.id) ?? 0,
          pos: seedPos(mn.id, i),
        };
        byId.set(mn.id, node);
        return node;
      });
      links = model.edges
        .map((e) => [byId.get(e.source), byId.get(e.target)] as const)
        .filter((pair): pair is [SimNode, SimNode] => Boolean(pair[0] && pair[1]))
        .map((pair) => [pair[0], pair[1]]);
      // Dropping a held node mid-rebuild would strand the pointer — clear it.
      if (dragNode && !byId.has(dragNode.id)) dragNode = null;
    };

    const rebuild = () => {
      fullModel = buildGraphModel(input.notes, input.links, cfg);
      const before = nodes.map((n) => n.id).join('\n');
      applyModel(timelapse ? timelapseSlice(fullModel, revealed) : fullModel);
      const after = nodes.map((n) => n.id).join('\n');
      if (before !== after) alpha = Math.max(alpha, 0.5);
    };
    rebuild();

    const radiusOf = (n: SimNode): number => {
      let base: number;
      if (n.kind === 'tag') base = 3.5;
      else if (n.kind === 'note' || n.kind === 'artifact') base = Math.min(14, 4 + n.degree * 1.5);
      else base = Math.min(11, 4 + n.degree * 1.2);
      return base * cfg.display.nodeSize;
    };

    // ---- Simulation ----------------------------------------------------------
    const tick = () => {
      const { center, repel, link, linkDistance } = cfg.forces;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.pos.x - a.pos.x;
          let dy = b.pos.y - a.pos.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = (rand(i * 31 + j) - 0.5) * 2;
            dy = (rand(j * 17 + i) - 0.5) * 2;
            d2 = dx * dx + dy * dy;
          }
          const force = (repel / d2) * alpha;
          const d = Math.sqrt(d2);
          a.pos.vx -= (dx / d) * force;
          a.pos.vy -= (dy / d) * force;
          b.pos.vx += (dx / d) * force;
          b.pos.vy += (dy / d) * force;
        }
      }
      for (const [a, b] of links) {
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const force = (d - linkDistance) * link * alpha;
        a.pos.vx += (dx / d) * force;
        a.pos.vy += (dy / d) * force;
        b.pos.vx -= (dx / d) * force;
        b.pos.vy -= (dy / d) * force;
      }
      for (const n of nodes) {
        if (n === dragNode) {
          // Held node stays pinned under the pointer.
          n.pos.vx = 0;
          n.pos.vy = 0;
          continue;
        }
        n.pos.vx -= n.pos.x * center * alpha;
        n.pos.vy -= n.pos.y * center * alpha;
        n.pos.vx *= 0.85;
        n.pos.vy *= 0.85;
        n.pos.x += n.pos.vx;
        n.pos.y += n.pos.vy;
      }
      alpha = Math.max(0.02, alpha * 0.995);
    };

    // ---- Viewport ------------------------------------------------------------
    let scale = 1;
    let ox = 0;
    let oy = 0;
    let raf = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ox = canvas.clientWidth / 2;
      oy = canvas.clientHeight / 2;
    };
    resize();

    const colorOf = (n: SimNode): string => {
      if (n.path && n.path === path) return colActive;
      if (n.color) return n.color;
      switch (n.kind) {
        case 'tag':
          return colTag;
        case 'artifact':
          return colArtifact;
        case 'attachment':
          return colAttach;
        case 'phantom':
          return colPhantom;
        default:
          return colNode;
      }
    };

    const draw = () => {
      tick();
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);

      // Edges (batched — identical to the original when arrows are off).
      ctx.strokeStyle = colEdge;
      ctx.lineWidth = (1 / scale) * cfg.display.linkThickness;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      for (const [a, b] of links) {
        ctx.moveTo(a.pos.x, a.pos.y);
        ctx.lineTo(b.pos.x, b.pos.y);
      }
      ctx.stroke();

      if (cfg.display.arrows) {
        ctx.fillStyle = colEdge;
        const size = 6 / scale;
        for (const [a, b] of links) {
          const dx = b.pos.x - a.pos.x;
          const dy = b.pos.y - a.pos.y;
          const d = Math.hypot(dx, dy);
          if (d < 1) continue;
          const ux = dx / d;
          const uy = dy / d;
          const tr = radiusOf(b) + 1.5;
          const tipX = b.pos.x - ux * tr;
          const tipY = b.pos.y - uy * tr;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - ux * size - uy * size * 0.55, tipY - uy * size + ux * size * 0.55);
          ctx.lineTo(tipX - ux * size + uy * size * 0.55, tipY - uy * size - ux * size * 0.55);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // Nodes.
      const showLabels = scale > cfg.display.textFadeThreshold || nodes.length < 40;
      for (const n of nodes) {
        const r = radiusOf(n);
        ctx.beginPath();
        ctx.fillStyle = colorOf(n);
        ctx.arc(n.pos.x, n.pos.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (showLabels) {
          ctx.fillStyle = colText;
          ctx.font = `${11 / scale}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(n.label, n.pos.x, n.pos.y + r + 12 / scale);
        }
      }
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // ---- Timelapse -----------------------------------------------------------
    const startTimelapse = () => {
      if (timelapse) return;
      timelapse = true;
      order = timelapseOrder(fullModel.nodes);
      revealed = 0;
      applyModel(timelapseSlice(fullModel, revealed));
      alpha = 1;
      const step = () => {
        revealed += 1;
        applyModel(timelapseSlice(fullModel, revealed));
        alpha = 1; // reheat as the graph grows
        if (revealed < order.length) stepTimer = window.setTimeout(step, 130);
        else stepTimer = 0;
      };
      stepTimer = window.setTimeout(step, 130);
    };
    const stopTimelapse = () => {
      if (!timelapse) return;
      timelapse = false;
      if (stepTimer) {
        clearTimeout(stepTimer);
        stepTimer = 0;
      }
      applyModel(fullModel);
      alpha = Math.max(alpha, 0.5);
    };

    // ---- Controller (React ↔ sim) -------------------------------------------
    let lastSig = filterGroupSignature(cfg);
    controllerRef.current = {
      setConfig: (next) => {
        cfg = next;
        const sig = filterGroupSignature(next);
        if (sig !== lastSig) {
          lastSig = sig;
          rebuild();
        }
      },
      animate: () => {
        alpha = 1;
      },
      startTimelapse,
      stopTimelapse,
    };

    // ---- Dev-only inspection hook (tests assert positions / counts) ----------
    if (import.meta.env.DEV) {
      window.__graphDebug = {
        count: () => nodes.length,
        nodes: () => nodes.map((n) => ({ id: n.id, kind: n.kind, x: n.pos.x, y: n.pos.y })),
        screen: (id) => {
          const n = nodes.find((x) => x.id === id);
          if (!n) return null;
          const rect = canvas.getBoundingClientRect();
          return { x: rect.left + ox + n.pos.x * scale, y: rect.top + oy + n.pos.y * scale };
        },
        timelapsing: () => timelapse,
      };
    }

    // ---- Gestures: drag node / pan / pinch / tap-to-open ----------------------
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    let moved = false;

    const hitTest = (clientX: number, clientY: number): SimNode | null => {
      const rect = canvas.getBoundingClientRect();
      const gx = (clientX - rect.left - ox) / scale;
      const gy = (clientY - rect.top - oy) / scale;
      for (const n of nodes) {
        if (Math.hypot(n.pos.x - gx, n.pos.y - gy) < 22) return n;
      }
      return null;
    };

    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
      if (pointers.size === 1) {
        dragNode = hitTest(e.clientX, e.clientY);
        if (dragNode) alpha = Math.max(alpha, 0.5);
      } else if (pointers.size === 2) {
        dragNode = null; // second finger → pinch, never drag
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        if (dragNode) {
          const rect = canvas.getBoundingClientRect();
          dragNode.pos.x = (e.clientX - rect.left - ox) / scale;
          dragNode.pos.y = (e.clientY - rect.top - oy) / scale;
          dragNode.pos.vx = 0;
          dragNode.pos.vy = 0;
          alpha = Math.max(alpha, 0.5); // neighbours react
        } else {
          ox += dx;
          oy += dy;
        }
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) {
          scale = Math.max(0.15, Math.min(4, scale * (d / pinchDist)));
        }
        pinchDist = d;
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        if (!moved) {
          const hit = hitTest(e.clientX, e.clientY);
          if (hit && hit.path && (hit.kind === 'note' || hit.kind === 'artifact')) {
            // Notes open in the reader; HTML artifacts open in the sandboxed viewer.
            useNav.getState().push(
              hit.kind === 'artifact'
                ? { name: 'artifact', path: hit.path }
                : { name: 'note', path: hit.path },
            );
          }
        }
        dragNode = null;
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      if (stepTimer) clearTimeout(stepTimer);
      controllerRef.current = null;
      if (import.meta.env.DEV) delete window.__graphDebug;
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', resize);
    };
  }, [path]);

  const wandButton = (size: number) => (
    <button
      className={nav.desktop ? 'iconbtn pane-header__btn' : 'iconbtn'}
      aria-label="Graph timelapse"
      aria-pressed={wandActive}
      style={wandActive ? { color: 'var(--ember)' } : undefined}
      onClick={() => setWandActive((v) => !v)}
    >
      <IconWand size={size} />
    </button>
  );
  const settingsButton = (size: number) => (
    <button
      className={nav.desktop ? 'iconbtn pane-header__btn' : 'iconbtn'}
      aria-label="Graph settings"
      aria-pressed={panelOpen}
      style={panelOpen ? { color: 'var(--ember)' } : undefined}
      onClick={() => setPanelOpen((v) => !v)}
    >
      <IconSettings size={size} />
    </button>
  );

  return (
    <div className="screen">
      {nav.desktop ? (
        // Same pane-header chrome as the note screens (Obsidian's graph tab):
        // history arrows, centered title, wand + settings on the right.
        <div className="pane-header">
          <div className="pane-header__group">
            <button
              className="iconbtn pane-header__btn"
              aria-label="Back"
              disabled={!nav.canBack()}
              onClick={() => nav.back()}
            >
              <IconBack size={18} style={{ opacity: nav.canBack() ? 1 : 0.35 }} />
            </button>
            <button
              className="iconbtn pane-header__btn"
              aria-label="Forward"
              disabled={!nav.canForward()}
              onClick={() => nav.forward()}
            >
              <IconBack
                size={18}
                style={{ transform: 'rotate(180deg)', opacity: nav.canForward() ? 1 : 0.35 }}
              />
            </button>
          </div>
          <div className="pane-header__crumbs">
            <span className="pane-header__crumb pane-header__crumb--leaf">
              {path ? `Links around "${noteTitle(path)}"` : 'Graph view'}
            </span>
          </div>
          <div className="pane-header__group">
            {wandButton(18)}
            {settingsButton(18)}
          </div>
        </div>
      ) : (
        <header className="workspace-top">
          <button
            className="iconbtn workspace-top__group"
            aria-label="Back"
            onClick={() => nav.back()}
          >
            <IconBack size={20} />
          </button>
          <span className="workspace-top__status">
            {path ? `Links around "${noteTitle(path)}"` : 'Graph'}
          </span>
          <div className="workspace-top__group" style={{ marginLeft: 'auto' }}>
            {wandButton(20)}
            {settingsButton(20)}
          </div>
        </header>
      )}
      <canvas ref={canvasRef} style={{ flex: 1, width: '100%', touchAction: 'none' }} />
      {panelOpen && (
        <GraphPanel
          config={config}
          onChange={setConfig}
          onClose={() => setPanelOpen(false)}
          onAnimate={() => controllerRef.current?.animate()}
        />
      )}
    </div>
  );
}
