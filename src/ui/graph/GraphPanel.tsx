import { useState, type ReactNode } from 'react';
import { IconChevronRight, IconPlus, IconX } from '@/ui/icons';
import { GRAPH_PALETTE, type GraphConfig, type GraphGroup } from './config';

interface Props {
  config: GraphConfig;
  onChange: (next: GraphConfig) => void;
  onClose: () => void;
  /** Reheat the simulation (alpha = 1). */
  onAnimate: () => void;
}

type Section = 'filters' | 'groups' | 'display' | 'forces';

function newGroupId(): string {
  return `g-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Graph settings panel: filters, groups, display and forces. */
export function GraphPanel({ config, onChange, onClose, onAnimate }: Props) {
  const [open, setOpen] = useState<Record<Section, boolean>>({
    filters: true,
    groups: true,
    display: true,
    forces: true,
  });
  const toggleSection = (s: Section) => setOpen((o) => ({ ...o, [s]: !o[s] }));

  const { filters, groups, display, forces } = config;
  const setFilters = (patch: Partial<GraphConfig['filters']>) =>
    onChange({ ...config, filters: { ...filters, ...patch } });
  const setDisplay = (patch: Partial<GraphConfig['display']>) =>
    onChange({ ...config, display: { ...display, ...patch } });
  const setForces = (patch: Partial<GraphConfig['forces']>) =>
    onChange({ ...config, forces: { ...forces, ...patch } });
  const setGroups = (next: GraphGroup[]) => onChange({ ...config, groups: next });

  const addGroup = () =>
    setGroups([
      ...groups,
      { id: newGroupId(), query: '', color: GRAPH_PALETTE[groups.length % GRAPH_PALETTE.length] },
    ]);
  const updateGroup = (id: string, patch: Partial<GraphGroup>) =>
    setGroups(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const removeGroup = (id: string) => setGroups(groups.filter((g) => g.id !== id));
  const cycleColor = (g: GraphGroup) => {
    const i = GRAPH_PALETTE.indexOf(g.color as (typeof GRAPH_PALETTE)[number]);
    updateGroup(g.id, { color: GRAPH_PALETTE[(i + 1) % GRAPH_PALETTE.length] });
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="graph-panel" role="dialog" aria-label="Graph settings">
        <header className="graph-panel__head">
          <span>Graph settings</span>
          <button className="iconbtn" aria-label="Close graph settings" onClick={onClose}>
            <IconX size={18} />
          </button>
        </header>

        <div className="graph-panel__scroll">
          <PanelSection title="Filters" open={open.filters} onToggle={() => toggleSection('filters')}>
            <input
              className="dialog__input graph-panel__search"
              value={filters.search}
              placeholder="Search files"
              aria-label="Search files"
              onChange={(e) => setFilters({ search: e.target.value })}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <PanelToggle
              label="Tags"
              value={filters.tags}
              onChange={(v) => setFilters({ tags: v })}
            />
            <PanelToggle
              label="Attachments"
              value={filters.attachments}
              onChange={(v) => setFilters({ attachments: v })}
            />
            <PanelToggle
              label="Existing files only"
              value={filters.existingOnly}
              onChange={(v) => setFilters({ existingOnly: v })}
            />
            <PanelToggle
              label="Orphans"
              value={filters.orphans}
              onChange={(v) => setFilters({ orphans: v })}
            />
          </PanelSection>

          <PanelSection title="Groups" open={open.groups} onToggle={() => toggleSection('groups')}>
            {groups.map((g) => (
              <div className="graph-group-row" key={g.id}>
                <button
                  className="graph-swatch"
                  style={{ background: g.color }}
                  aria-label="Group color"
                  onClick={() => cycleColor(g)}
                />
                <input
                  className="dialog__input"
                  value={g.query}
                  placeholder="tag:x · path:folder · title"
                  aria-label="Group query"
                  onChange={(e) => updateGroup(g.id, { query: e.target.value })}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  className="iconbtn"
                  aria-label="Remove group"
                  onClick={() => removeGroup(g.id)}
                >
                  <IconX size={16} />
                </button>
              </div>
            ))}
            <button className="graph-panel__btn" onClick={addGroup}>
              <span className="row__icon">
                <IconPlus size={16} />
              </span>
              New group
            </button>
          </PanelSection>

          <PanelSection title="Display" open={open.display} onToggle={() => toggleSection('display')}>
            <PanelToggle
              label="Arrows"
              value={display.arrows}
              onChange={(v) => setDisplay({ arrows: v })}
            />
            <PanelSlider
              label="Text fade threshold"
              min={0}
              max={2}
              step={0.05}
              value={display.textFadeThreshold}
              onChange={(v) => setDisplay({ textFadeThreshold: v })}
            />
            <PanelSlider
              label="Node size"
              min={0.3}
              max={3}
              step={0.1}
              value={display.nodeSize}
              onChange={(v) => setDisplay({ nodeSize: v })}
            />
            <PanelSlider
              label="Link thickness"
              min={0.3}
              max={4}
              step={0.1}
              value={display.linkThickness}
              onChange={(v) => setDisplay({ linkThickness: v })}
            />
            <button className="graph-panel__btn" onClick={onAnimate}>
              Animate
            </button>
          </PanelSection>

          <PanelSection title="Forces" open={open.forces} onToggle={() => toggleSection('forces')}>
            <PanelSlider
              label="Center force"
              min={0}
              max={0.02}
              step={0.001}
              value={forces.center}
              onChange={(v) => setForces({ center: v })}
            />
            <PanelSlider
              label="Repel force"
              min={200}
              max={6000}
              step={100}
              value={forces.repel}
              onChange={(v) => setForces({ repel: v })}
            />
            <PanelSlider
              label="Link force"
              min={0}
              max={0.1}
              step={0.005}
              value={forces.link}
              onChange={(v) => setForces({ link: v })}
            />
            <PanelSlider
              label="Link distance"
              min={20}
              max={300}
              step={5}
              value={forces.linkDistance}
              onChange={(v) => setForces({ linkDistance: v })}
            />
          </PanelSection>
        </div>
      </div>
    </>
  );
}

function PanelSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="graph-panel__section">
      <button
        className="graph-panel__section-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <IconChevronRight
          size={16}
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur) var(--ease)' }}
        />
        {title}
      </button>
      {open && <div className="graph-panel__body">{children}</div>}
    </section>
  );
}

function PanelToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="setting" style={{ minHeight: 44, padding: '6px 0' }}>
      <div className="setting__body">
        <p className="setting__label">{label}</p>
      </div>
      <button
        className="toggle"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
      />
    </div>
  );
}

/** Format a slider value compactly (no long float tails). */
function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(v < 0.1 ? 3 : v < 1 ? 2 : 2).replace(/\.?0+$/, '');
}

function PanelSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="graph-slider">
      <div className="graph-slider__head">
        <span className="setting__label">{label}</span>
        <span className="setting__value">{fmt(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
