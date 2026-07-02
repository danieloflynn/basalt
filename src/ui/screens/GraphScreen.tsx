import { useEffect, useRef } from 'react';
import { noteTitle } from '@/lib/paths';
import { vaultService } from '@/services';
import { useNav } from '@/state/nav';
import { IconBack } from '@/ui/icons';

interface GraphNode {
  path: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

/** Force-directed graph of the vault (or a note's neighborhood). Tap a node to open it. */
export function GraphScreen({ path }: { path?: string }) {
  const nav = useNav();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // --- Build graph data -------------------------------------------------
    const { nodes: allPaths, edges: allEdges } = vaultService.linkGraph();
    let paths = allPaths;
    let edges = allEdges;
    if (path) {
      const keep = new Set<string>([path]);
      for (const [a, b] of allEdges) {
        if (a === path) keep.add(b);
        if (b === path) keep.add(a);
      }
      paths = allPaths.filter((p) => keep.has(p));
      edges = allEdges.filter(([a, b]) => keep.has(a) && keep.has(b));
    }

    const degree = new Map<string, number>();
    for (const [a, b] of edges) {
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    }

    const rand = (seed: number) => {
      // deterministic-ish placement so re-opens look familiar
      const x = Math.sin(seed * 999) * 10_000;
      return x - Math.floor(x);
    };
    const nodes: GraphNode[] = paths.map((p, i) => ({
      path: p,
      label: noteTitle(p),
      x: (rand(i + 1) - 0.5) * 600,
      y: (rand(i + 101) - 0.5) * 600,
      vx: 0,
      vy: 0,
      degree: degree.get(p) ?? 0,
    }));
    const byPath = new Map(nodes.map((n) => [n.path, n]));
    const links = edges
      .map(([a, b]) => [byPath.get(a), byPath.get(b)] as const)
      .filter((pair): pair is [GraphNode, GraphNode] => Boolean(pair[0] && pair[1]));

    // --- Simulation --------------------------------------------------------
    let alpha = 1;
    const styles = getComputedStyle(document.documentElement);
    const colEdge = styles.getPropertyValue('--border-strong').trim() || '#555';
    const colNode = styles.getPropertyValue('--column-rock-lit').trim() || '#888';
    const colActive = styles.getPropertyValue('--ember').trim() || '#e8764a';
    const colText = styles.getPropertyValue('--text-muted').trim() || '#aaa';

    const tick = () => {
      // repulsion (O(n²) is fine for personal-vault sizes)
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = (rand(i * 31 + j) - 0.5) * 2;
            dy = (rand(j * 17 + i) - 0.5) * 2;
            d2 = dx * dx + dy * dy;
          }
          const force = (2200 / d2) * alpha;
          const d = Math.sqrt(d2);
          a.vx -= (dx / d) * force;
          a.vy -= (dy / d) * force;
          b.vx += (dx / d) * force;
          b.vy += (dy / d) * force;
        }
      }
      // springs
      for (const [a, b] of links) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const force = (d - 110) * 0.02 * alpha;
        a.vx += (dx / d) * force;
        a.vy += (dy / d) * force;
        b.vx -= (dx / d) * force;
        b.vy -= (dy / d) * force;
      }
      // centering + integrate
      for (const n of nodes) {
        n.vx -= n.x * 0.005 * alpha;
        n.vy -= n.y * 0.005 * alpha;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
      }
      alpha = Math.max(0.02, alpha * 0.995);
    };

    // --- Viewport ----------------------------------------------------------
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

    const draw = () => {
      tick();
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);

      ctx.strokeStyle = colEdge;
      ctx.lineWidth = 1 / scale;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      for (const [a, b] of links) {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      for (const n of nodes) {
        const r = Math.min(14, 4 + n.degree * 1.5);
        ctx.beginPath();
        ctx.fillStyle = n.path === path ? colActive : colNode;
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (scale > 0.55 || nodes.length < 40) {
          ctx.fillStyle = colText;
          ctx.font = `${11 / scale}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(n.label, n.x, n.y + r + 12 / scale);
        }
      }
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // --- Gestures: drag to pan, pinch to zoom, tap to open ------------------
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    let moved = false;

    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
      if (pointers.size === 2) {
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
        ox += dx;
        oy += dy;
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
      if (!moved && pointers.size === 0) {
        const rect = canvas.getBoundingClientRect();
        const gx = (e.clientX - rect.left - ox) / scale;
        const gy = (e.clientY - rect.top - oy) / scale;
        for (const n of nodes) {
          if (Math.hypot(n.x - gx, n.y - gy) < 22) {
            useNav.getState().push({ name: 'note', path: n.path });
            return;
          }
        }
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', resize);
    };
  }, [path]);

  return (
    <div className="screen">
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
      </header>
      <canvas ref={canvasRef} style={{ flex: 1, width: '100%', touchAction: 'none' }} />
    </div>
  );
}
