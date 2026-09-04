// prototypes/veil-standard-pattern/sketch.mjs
// Renders review sketches straight out of the real engine (no hand-drawing):
//   samples/run-continuity.svg  - the 4-panel run + the 5th panel continuing
//   samples/preset-strip.svg    - one panel per standard recipe, for comparison
//
//   node prototypes/veil-standard-pattern/sketch.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildField, PANEL } from './pattern-core.js';
import { svgPath } from './shape-paths.js';
import { PRESETS } from './presets.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'samples');
mkdirSync(out, { recursive: true });

const n = (v) => Number(v).toFixed(2);
const holes = (list, opacity = 1, fill = '#14161a') => {
  const body = list
    .map((h) => {
      const d = svgPath(h);
      return d ? `<path d="${d}"/>` : `<circle cx="${n(h.cx)}" cy="${n(h.cy)}" r="${n(h.r)}"/>`;
    })
    .join('');
  return `<g fill="${fill}" opacity="${opacity}">${body}</g>`;
};
const frame = (pn, dash) =>
  `<rect x="${n(pn.x - (PANEL.moduleW - PANEL.faceW) / 2)}" y="${n(
    pn.y - (PANEL.moduleH - PANEL.faceH) / 2
  )}" width="${PANEL.moduleW}" height="${PANEL.moduleH}" fill="none" stroke="#9aa0a6" stroke-width="3"${
    dash ? ' stroke-dasharray="20 14"' : ''
  }/>`;
const label = (x, y, text, size = 34, fill = '#6b7076', anchor = 'middle') =>
  `<text x="${n(x)}" y="${n(y)}" font-family="Inter, Arial, sans-serif" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${text}</text>`;

// -- 1. the 4-panel run, plus the panel that continues it -------------------
{
  const params = {
    cols: 4,
    rows: 1,
    lattice: 'stagger',
    pitch: 34,
    minDia: 10,
    maxDia: 28,
    modulation: 'linear',
    modAngle: 0,
    modScope: 'locked',
    spanMm: 2400,
  };
  const run = buildField(params);
  const ext = buildField({ ...params, cols: 5 });
  const ghostPanel = ext.panels.find((p) => p.col === 4);
  const ghostHoles = ext.holes.filter((h) => h.panelCol === 4);

  const pad = 150;
  const w = run.fieldW + PANEL.moduleW + params.pitch + pad * 2;
  const h = run.fieldH + pad * 2 + 120;

  const body = [
    `<rect x="${-pad}" y="${-pad}" width="${n(w)}" height="${n(h)}" fill="#f7f6f3"/>`,
    ...run.panels.map((pn) => frame(pn, false)),
    holes(run.holes),
    frame(ghostPanel, true),
    holes(ghostHoles, 0.24),
    ...run.panels.map((pn) => label(pn.x + pn.w / 2, pn.y + pn.h + 62, pn.label, 40, '#8c9298')),
    label(
      ghostPanel.x + ghostPanel.w / 2,
      ghostPanel.y + ghostPanel.h / 2,
      'continues',
      42,
      '#8c9298'
    ),
    label(
      ghostPanel.x + ghostPanel.w / 2,
      ghostPanel.y + ghostPanel.h / 2 + 52,
      'same lattice, no reflow',
      28,
      '#a4a9ae'
    ),
    label(0, -60, 'VEIL standard pattern - 4-panel run, extendable', 46, '#14161a', 'start'),
    label(
      0,
      -18,
      `stagger 34mm pitch  |  10-28mm gradient  |  ${run.stats.placed} holes  |  ${run.stats.openPct.toFixed(1)}% open`,
      30,
      '#6b7076',
      'start'
    ),
    label(
      0,
      run.fieldH + 120,
      'Panel seams are cut lines only - the lattice is generated once across the whole field.',
      28,
      '#8c9298',
      'start'
    ),
  ].join('\n');

  writeFileSync(
    join(out, 'run-continuity.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${n(w)} ${n(h)}" width="1600">\n${body}\n</svg>\n`
  );
}

// -- 2. one panel per standard recipe --------------------------------------
{
  const cell = PANEL.moduleW + 130;
  const perRow = 5;
  const rows = Math.ceil(PRESETS.length / perRow);
  const w = perRow * cell + 100;
  const h = rows * (PANEL.moduleH + 240) + 140;

  const tiles = PRESETS.map((preset, i) => {
    const f = buildField({ ...preset.params, cols: 1, rows: 1 });
    const tx = (i % perRow) * cell + 50;
    const ty = Math.floor(i / perRow) * (PANEL.moduleH + 240) + 120;
    return [
      `<g transform="translate(${n(tx)},${n(ty)})">`,
      frame(f.panels[0], false),
      holes(f.holes),
      label(PANEL.moduleW / 2, PANEL.moduleH + 62, preset.name, 38, '#14161a'),
      label(
        PANEL.moduleW / 2,
        PANEL.moduleH + 108,
        `${f.stats.placed} holes  ${f.stats.openPct.toFixed(1)}% open`,
        30,
        '#8c9298'
      ),
      '</g>',
    ].join('\n');
  }).join('\n');

  writeFileSync(
    join(out, 'preset-strip.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w)} ${n(h)}" width="1800">
<rect width="${n(w)}" height="${n(h)}" fill="#f7f6f3"/>
${label(50, 62, 'Standard recipes - one 600x1200 module each (working names, not catalog SKUs)', 46, '#14161a', 'start')}
${tiles}
</svg>
`
  );
}

console.log('wrote samples/run-continuity.svg and samples/preset-strip.svg');
