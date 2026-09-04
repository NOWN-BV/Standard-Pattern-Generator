// prototypes/veil-standard-pattern/VeilStandardPatternGenerator.jsx
// VEIL / Arktura standard-pattern generator - adjust, preview, export.
//
// Default configuration is a 4-panel run (cols=4, rows=1) on a continuous
// lattice: the pattern is generated once in field coordinates and the panel
// seams only decide where the sheet is cut. "Add panel" extends the run and,
// with modScope='locked', every hole already placed keeps its exact size and
// position - which is what makes a run extendable on site.
//
// Mount example:
//   import Gen from './VeilStandardPatternGenerator.jsx';
//   createRoot(document.getElementById('root')).render(<Gen />);

import React, { useMemo, useState } from 'react';
import { buildField, DEFAULTS, PANEL, LIMITS } from './pattern-core.js';
import { svgPath } from './shape-paths.js';
import { findPreset } from './presets.js';
import PatternControls, { Group, Select, Slider, Toggle } from './PatternControls.jsx';
import { toSVG, toDXF, toPayload, toRecipe, download, downloadPNG } from './exporters.js';

const INK = '#0e0f11';
const PAPER = '#f6f5f2';

const shell = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0,1fr) 300px',
  gap: 0,
  height: '100vh',
  background: PAPER,
  color: INK,
  fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
};

const railStyle = {
  borderLeft: '1px solid rgba(0,0,0,.1)',
  padding: '18px 18px 60px',
  overflowY: 'auto',
  background: '#fffefb',
};

const btn = {
  flex: '1 1 auto',
  padding: '7px 8px',
  fontSize: 11,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  background: INK,
  color: PAPER,
  border: 0,
  borderRadius: 3,
  cursor: 'pointer',
};

const chip = { fontSize: 11, opacity: 0.62, fontVariantNumeric: 'tabular-nums' };

function Stat({ k, v }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 78 }}>
      <span
        style={{ fontSize: 9, letterSpacing: '.14em', textTransform: 'uppercase', opacity: 0.42 }}
      >
        {k}
      </span>
      <span style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
}

/** One panel: face outline, seam, label. */
function PanelFrame({ pn, showLabels }) {
  return (
    <g>
      <rect
        x={pn.x - (PANEL.moduleW - PANEL.faceW) / 2}
        y={pn.y - (PANEL.moduleH - PANEL.faceH) / 2}
        width={PANEL.moduleW}
        height={PANEL.moduleH}
        fill="none"
        stroke="rgba(0,0,0,.16)"
        strokeWidth={2}
      />
      <rect
        x={pn.x}
        y={pn.y}
        width={pn.w}
        height={pn.h}
        fill="none"
        stroke="rgba(0,0,0,.28)"
        strokeWidth={1}
        strokeDasharray="8 6"
      />
      {showLabels ? (
        <text
          x={pn.x + pn.w / 2}
          y={pn.y + pn.h - 18}
          textAnchor="middle"
          fontSize={42}
          fill="rgba(0,0,0,.22)"
        >
          {pn.label}
        </text>
      ) : null}
    </g>
  );
}

function Holes({ holes, fill, opacity = 1 }) {
  return (
    <g fill={fill} opacity={opacity}>
      {holes.map((h) => {
        const d = svgPath(h);
        return d ? <path key={h.id} d={d} /> : <circle key={h.id} cx={h.cx} cy={h.cy} r={h.r} />;
      })}
    </g>
  );
}

export default function VeilStandardPatternGenerator() {
  const [params, setParams] = useState({ ...DEFAULTS });
  const [presetId, setPresetId] = useState('');
  const [showPanels, setShowPanels] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showNext, setShowNext] = useState(true);

  const set = (k, v) => {
    setParams((prev) => ({ ...prev, [k]: v }));
    setPresetId(''); // any manual edit detaches from the preset
  };

  const applyPreset = (id) => {
    const preset = findPreset(id);
    setPresetId(id);
    if (preset)
      setParams((prev) => ({
        ...DEFAULTS,
        cols: prev.cols,
        rows: prev.rows,
        gap: prev.gap,
        ...preset.params,
      }));
  };

  const field = useMemo(() => buildField(params), [params]);

  // Continuation preview: the same recipe with one more panel across. Only
  // the extra panel's holes are drawn, ghosted - proof that the lattice
  // carries through the seam instead of restarting at each panel.
  const ghost = useMemo(() => {
    if (!showNext) return null;
    const next = buildField({ ...params, cols: params.cols + 1 });
    return {
      panel: next.panels.find((p) => p.col === params.cols && p.row === 0),
      holes: next.holes.filter((h) => h.panelCol === params.cols),
    };
  }, [params, showNext]);

  const vbPad = 60;
  const vbW = field.fieldW + (ghost ? PANEL.moduleW + params.gap : 0) + vbPad * 2;
  const vbH = field.fieldH + vbPad * 2;

  const meta = {
    presetId: presetId || 'STD',
    presetName: findPreset(presetId)?.name || 'Custom standard pattern',
  };
  const stem = `veil-standard-${params.lattice}-${params.modulation}-${params.cols}x${params.rows}`;

  return (
    <div style={shell}>
      <main
        style={{
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 14,
            padding: '16px 22px 10px',
            borderBottom: '1px solid rgba(0,0,0,.08)',
          }}
        >
          <span style={{ fontSize: 13, letterSpacing: '.22em', textTransform: 'uppercase' }}>
            VEIL / standard pattern
          </span>
          <span style={chip}>
            {params.cols} x {params.rows} panels &middot; {field.fieldW} x {field.fieldH} mm
          </span>
          <span style={{ ...chip, marginLeft: 'auto' }}>{meta.presetName}</span>
        </header>

        {field.stats.placed === 0 ? (
          <div
            style={{
              margin: '10px 22px 0',
              padding: '9px 12px',
              fontSize: 12,
              lineHeight: 1.5,
              border: '1px solid rgba(180,60,20,.4)',
              background: 'rgba(200,80,30,.07)',
              borderRadius: 3,
            }}
          >
            Nothing is cut: all {field.stats.dropped} candidate holes fall under the{' '}
            {LIMITS.minPerfArea}mm2 minimum perforation area or inside the {params.edgeInset}mm edge
            keep-out. Thin shapes (slot, cross, triangle) enclose little area per unit of extent, so
            they need a larger diameter than a circle to be cuttable.
          </div>
        ) : null}

        <div style={{ flex: 1, minHeight: 0, padding: '10px 22px 0' }}>
          <svg
            viewBox={`${-vbPad} ${-vbPad} ${vbW} ${vbH}`}
            style={{ width: '100%', height: '100%', display: 'block' }}
            preserveAspectRatio="xMidYMid meet"
          >
            {showPanels
              ? field.panels.map((pn) => (
                  <PanelFrame key={pn.label} pn={pn} showLabels={showLabels} />
                ))
              : null}
            <Holes holes={field.holes} fill={INK} />

            {ghost && ghost.panel ? (
              <g>
                <rect
                  x={ghost.panel.x - (PANEL.moduleW - PANEL.faceW) / 2}
                  y={ghost.panel.y - (PANEL.moduleH - PANEL.faceH) / 2}
                  width={PANEL.moduleW}
                  height={PANEL.moduleH}
                  fill="none"
                  stroke="rgba(0,0,0,.18)"
                  strokeWidth={2}
                  strokeDasharray="14 10"
                />
                <Holes holes={ghost.holes} fill={INK} opacity={0.22} />
                <text
                  x={ghost.panel.x + ghost.panel.w / 2}
                  y={ghost.panel.y + ghost.panel.h / 2}
                  textAnchor="middle"
                  fontSize={34}
                  fill="rgba(0,0,0,.3)"
                >
                  continues
                </text>
              </g>
            ) : null}
          </svg>
        </div>

        <footer
          style={{
            display: 'flex',
            gap: 26,
            alignItems: 'flex-end',
            padding: '12px 22px 16px',
            borderTop: '1px solid rgba(0,0,0,.08)',
          }}
        >
          <Stat k="holes" v={field.stats.placed.toLocaleString()} />
          <Stat k="open area" v={`${field.stats.openPct.toFixed(1)}%`} />
          <Stat
            k="dia range"
            v={`${field.stats.holeMinDia.toFixed(1)} - ${field.stats.holeMaxDia.toFixed(1)}`}
          />
          <Stat k="edge shrunk" v={field.stats.shrunk} />
          <Stat k="dropped" v={field.stats.dropped} />
          <Stat k="per panel" v={Math.round(field.stats.placed / (params.cols * params.rows))} />
          <div
            style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: 420 }}
          >
            <button
              style={btn}
              onClick={() => download(`${stem}.svg`, toSVG(field), 'image/svg+xml')}
            >
              SVG
            </button>
            <button
              style={btn}
              onClick={() => download(`${stem}.dxf`, toDXF(field, meta), 'application/dxf')}
            >
              DXF
            </button>
            <button style={btn} onClick={() => downloadPNG(field, `${stem}.png`)}>
              PNG
            </button>
            <button
              style={btn}
              onClick={() =>
                download(
                  `${stem}.payload.json`,
                  JSON.stringify(toPayload(field, meta), null, 2),
                  'application/json'
                )
              }
            >
              Payload
            </button>
            <button
              style={btn}
              onClick={() =>
                download(
                  `${stem}.recipe.json`,
                  JSON.stringify(toRecipe(field, meta), null, 2),
                  'application/json'
                )
              }
            >
              Recipe
            </button>
          </div>
        </footer>
      </main>

      <aside style={railStyle}>
        <PatternControls
          params={params}
          onChange={set}
          presetId={presetId}
          onPreset={applyPreset}
        />

        <Group title="Continuity">
          <Select
            name="ramp anchor"
            value={params.modScope}
            options={[
              { value: 'locked', label: 'locked (mm)' },
              { value: 'run', label: 'span the run' },
            ]}
            onChange={(v) => set('modScope', v)}
          />
          {params.modScope === 'locked' ? (
            <Slider
              name="ramp span"
              value={params.spanMm}
              min={600}
              max={12000}
              step={100}
              unit="mm"
              onChange={(v) => set('spanMm', v)}
            />
          ) : null}
          <div style={{ fontSize: 11, opacity: 0.55, lineHeight: 1.45, marginTop: 6 }}>
            {params.modScope === 'locked'
              ? 'Locked: the ramp is anchored in millimetres, so adding a panel extends the run and every existing hole is unchanged.'
              : 'Span the run: the ramp restretches to the run length, so adding a panel resizes every hole. Good for a fixed wall, wrong for a run that grows.'}
          </div>
        </Group>

        <Group title="Preview">
          <Toggle name="panel frames" value={showPanels} onChange={setShowPanels} />
          <Toggle name="panel labels" value={showLabels} onChange={setShowLabels} />
          <Toggle name="next panel ghost" value={showNext} onChange={setShowNext} />
        </Group>

        <div style={{ fontSize: 10, opacity: 0.42, lineHeight: 1.5, marginTop: 20 }}>
          Face {PANEL.faceW} x {PANEL.faceH} mm on a {PANEL.moduleW} x {PANEL.moduleH} module. DXF
          export uses the {PANEL.exportGap}mm nesting gap and the three-layer contract in
          DXF_BUILDER.md. Hole diameters are clamped to {LIMITS.minDia}-{LIMITS.maxDia}mm with a{' '}
          {LIMITS.minGap}mm minimum land.
        </div>
      </aside>
    </div>
  );
}
