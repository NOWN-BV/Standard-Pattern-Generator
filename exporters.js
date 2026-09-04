// prototypes/veil-standard-pattern/exporters.js
// SVG / DXF / payload writers for the standard-pattern generator.
//
// The DXF writer follows DXF_BUILDER.md sections 2-5 exactly: three layers
// (Panel_Boundary, THRU_CUT_PATTERN, PANEL_LABELS), AC1009 / R12, millimetres,
// Y-up, A1 = bottom-left, true colour on every perforation entity.
//
// In production the server owns DXF generation (the browser never emits cut
// files - see CLAUDE.md "Architecture context"). This client-side writer
// exists so the prototype is self-contained and reviewable; when this lands in
// the app, swap `downloadDXF` for a POST of `toPayload()` to the output
// registry and keep only the SVG preview here.

import { PANEL, colLetter } from './pattern-core.js';
import { shapeVerts, svgPath } from './shape-paths.js';

const f3 = (n) => Number(n).toFixed(3);

// ---------------------------------------------------------------- SVG ------

/** Standalone SVG of the field, in millimetres. */
/**
 * Every hole a panel has to cut, in panel-local mm.
 *
 * NOT the same as "holes whose panelCol/panelRow is this panel". A hole centred
 * exactly on a joint is shared: it sits half in each neighbour, and BOTH have to
 * cut their half. The owner test in buildField assigns such a hole to one panel
 * only (first match wins), which is right for counting and for the continuous
 * preview - but nesting from it drops the whole boundary column from the
 * neighbour, leaving a bare strip down one edge of every panel in the DXF.
 *
 * So this selects by GEOMETRY: any hole whose centre lies within the panel
 * module, edges inclusive. Shared holes appear in both sheets, which is what the
 * cutter needs.
 */
export function panelHoles(field, pn) {
  const e = 1e-6;
  const out = [];
  for (const h of field.holes) {
    if (h.cx < pn.x - e || h.cx > pn.x + PANEL.moduleW + e) continue;
    if (h.cy < pn.y - e || h.cy > pn.y + PANEL.moduleH + e) continue;
    out.push({ h, lx: h.cx - pn.x, ly: h.cy - pn.y });
  }
  return out;
}

export function toSVG(field, opts = {}) {
  const { holeFill = '#111111', panelStroke = '#c9ccd1', showPanels = true } = opts;
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f3(field.fieldW)}mm" height="${f3(
      field.fieldH
    )}mm" viewBox="0 0 ${f3(field.fieldW)} ${f3(field.fieldH)}">`
  );
  parts.push(`<rect width="${f3(field.fieldW)}" height="${f3(field.fieldH)}" fill="none"/>`);

  if (showPanels) {
    parts.push(`<g fill="none" stroke="${panelStroke}" stroke-width="1.5">`);
    for (const pn of field.panels) {
      parts.push(
        `<rect x="${f3(pn.x)}" y="${f3(pn.y)}" width="${f3(pn.w)}" height="${f3(pn.h)}"/>`
      );
    }
    parts.push('</g>');
  }

  parts.push(`<g fill="${holeFill}">`);
  for (const h of field.holes) {
    const d = svgPath(h);
    parts.push(
      d ? `<path d="${d}"/>` : `<circle cx="${f3(h.cx)}" cy="${f3(h.cy)}" r="${f3(h.r)}"/>`
    );
  }
  parts.push('</g></svg>');
  return parts.join('\n');
}

// ---------------------------------------------------------------- DXF ------

const hexToColorInt = (hex) => {
  const v = String(hex).replace('#', '');
  const r = parseInt(v.slice(0, 2), 16) || 0;
  const g = parseInt(v.slice(2, 4), 16) || 0;
  const b = parseInt(v.slice(4, 6), 16) || 0;
  return r * 65536 + g * 256 + b;
};

function dxfHeader(maxX, maxY) {
  return [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$ACADVER',
    '1',
    'AC1009',
    '9',
    '$INSBASE',
    '10',
    '0.0',
    '20',
    '0.0',
    '30',
    '0.0',
    '9',
    '$EXTMIN',
    '10',
    '0.0',
    '20',
    '0.0',
    '30',
    '0.0',
    '9',
    '$EXTMAX',
    '10',
    f3(maxX),
    '20',
    f3(maxY),
    '30',
    '0.0',
    '9',
    '$LIMMIN',
    '10',
    '0.0',
    '20',
    '0.0',
    '9',
    '$LIMMAX',
    '10',
    f3(maxX),
    '20',
    f3(maxY),
    '9',
    '$INSUNITS',
    '70',
    '4',
    '9',
    '$MEASUREMENT',
    '70',
    '1',
    '0',
    'ENDSEC',
  ];
}

function dxfTables() {
  const layer = (name, color) => [
    '0',
    'LAYER',
    '2',
    name,
    '70',
    '0',
    '62',
    String(color),
    '6',
    'CONTINUOUS',
  ];
  return [
    '0',
    'SECTION',
    '2',
    'TABLES',
    '0',
    'TABLE',
    '2',
    'LAYER',
    '70',
    '4',
    ...layer('0', 7),
    ...layer('Panel_Boundary', 7),
    ...layer('THRU_CUT_PATTERN', 1),
    ...layer('PANEL_LABELS', 3),
    '0',
    'ENDTAB',
    '0',
    'ENDSEC',
  ];
}

function polyline(layer, verts, colorInt) {
  const out = ['0', 'POLYLINE', '8', layer];
  if (colorInt != null) out.push('420', String(colorInt));
  out.push('66', '1', '70', '1', '10', '0.0', '20', '0.0', '30', '0.0');
  for (const [vx, vy] of verts) {
    out.push('0', 'VERTEX', '8', layer);
    if (colorInt != null) out.push('420', String(colorInt));
    out.push('10', f3(vx), '20', f3(vy), '30', '0.0');
  }
  out.push('0', 'SEQEND', '8', layer);
  return out;
}

/**
 * R12 DXF for the field. `meta` supplies the RAL + backer strings that go
 * into PANEL_LABELS; defaults are obviously-placeholder on purpose so an
 * un-configured export cannot be mistaken for a real release.
 */
export function toDXF(field, meta = {}) {
  const ral = meta.ral || { code: '9016', name: 'Traffic White', hex: '#F1F0EA' };
  const backer = meta.backer || 'aSoft None';
  const colorInt = hexToColorInt(ral.hex);

  const { cols, rows } = field.params;
  const PW = PANEL.moduleW;
  const PH = PANEL.moduleH;
  const SX = PW + PANEL.exportGap;
  const SY = PH + PANEL.exportGap;

  const ents = [];
  for (const pn of field.panels) {
    const bx = pn.col * SX;
    const by = (rows - 1 - pn.row) * SY;
    ents.push(
      ...polyline('Panel_Boundary', [
        [bx, by],
        [bx + PW, by],
        [bx + PW, by + PH],
        [bx, by + PH],
      ])
    );
    const label = `${colLetter(pn.col)}${rows - pn.row}  |  RAL ${ral.code} ${ral.name}  |  ${backer}`;
    const tx = bx + PW / 2;
    const ty = by + PH / 2;
    ents.push(
      '0',
      'TEXT',
      '8',
      'PANEL_LABELS',
      '10',
      f3(tx),
      '20',
      f3(ty),
      '30',
      '0.0',
      '40',
      '30.0',
      '1',
      label,
      '72',
      '1',
      '73',
      '2',
      '11',
      f3(tx),
      '21',
      f3(ty),
      '31',
      '0.0',
      '7',
      'Standard'
    );
  }

  // Walk PANELS, not holes: a shared boundary hole has to be emitted once per
  // panel that touches it, which a per-hole loop keyed on its owner cannot do.
  const nested = [];
  for (const pn of field.panels) {
    for (const e of panelHoles(field, pn)) {
      nested.push({ h: e.h, col: pn.col, row: pn.row, lx: e.lx, ly: e.ly });
    }
  }
  for (const item of nested) {
    const h = item.h;
    const bx = item.col * SX;
    const by = (rows - 1 - item.row) * SY;
    const wx = bx + item.lx;
    const wy = by + PH - item.ly;
    if (h.type === 'circle') {
      ents.push(
        '0',
        'CIRCLE',
        '8',
        'THRU_CUT_PATTERN',
        '420',
        String(colorInt),
        '10',
        f3(wx),
        '20',
        f3(wy),
        '30',
        '0.0',
        '40',
        f3(h.r)
      );
    } else {
      ents.push(
        ...polyline(
          'THRU_CUT_PATTERN',
          shapeVerts(h.type, wx, wy, h.r, { angle: h.angle, ratio: h.ratio, curve: h.curve }),
          colorInt
        )
      );
    }
  }

  const maxX = (cols - 1) * SX + PW;
  const maxY = (rows - 1) * SY + PH;
  const lines = [
    ...dxfHeader(maxX, maxY),
    ...dxfTables(),
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    ...ents,
    '0',
    'ENDSEC',
    '0',
    'EOF',
  ];
  return lines.join('\r\n') + '\r\n';
}

// ------------------------------------------------------------ payload ------

/** Lattice family -> the payload's 4-value patternType enum. */
const PATTERN_TYPE = {
  grid: 'grid',
  diagonal: 'grid',
  stagger: 'stagger',
  brick: 'stagger',
  hex: 'hex',
};

/**
 * `veil.spectral.v1` payload - the same contract the image-driven
 * configurator posts, so the existing server output registry can generate
 * DXF / PDF / PNG from a standard pattern with no backend change.
 *
 * The standard-pattern recipe (lattice family, modulation, seed...) has no
 * home in that schema, so it ships as a SEPARATE file from `toRecipe()`
 * rather than as extra keys here - the schema may be strict, and a rejected
 * payload is worse than a second file.
 */
export function toPayload(field, meta = {}) {
  const p = field.params;
  return {
    schema: 'veil.spectral.v1',
    timestamp: meta.timestamp || new Date().toISOString(),
    designId: meta.designId || 'VEIL-SP-0001',
    designLabel: meta.designLabel || `Standard pattern ${p.lattice}/${p.modulation}`,
    openness: Number(field.stats.openPct.toFixed(2)),
    unitSystem: 'metric',
    pattern: {
      name: meta.presetName || 'Standard pattern',
      version: '1',
      id: meta.presetId || 'STD',
      shape: p.shape,
      pitch: p.pitch,
      minHole: Math.max(1, field.stats.holeMinDia || p.minDia),
      maxHole: Math.max(1, field.stats.holeMaxDia || p.maxDia),
      patternType: PATTERN_TYPE[p.lattice] || 'grid',
      mapping: 'linear',
      threshold: 128,
      rotation: p.latticeAngle,
      invertImg: !!p.invert,
    },
    grid: { cols: p.cols, rows: p.rows },
    panel: {
      width: PANEL.moduleW,
      height: PANEL.moduleH,
      gap: PANEL.exportGap,
      innerW: PANEL.faceW,
      innerH: PANEL.faceH,
      perfLocalOffset: PANEL.perfInset,
    },
    ral: meta.ral || { code: '9016', name: 'Traffic White', hex: '#F1F0EA' },
    asoft: meta.asoft || { role: 'none', name: 'None' },
    field: {
      fieldW: field.fieldW,
      fieldH: field.fieldH,
      totalOpenArea: field.stats.openArea,
      rotation: p.latticeAngle,
    },
    shapes: field.holes.map((h) => ({
      id: h.id,
      type: h.type,
      cx: Number(h.cx.toFixed(4)),
      cy: Number(h.cy.toFixed(4)),
      r: Number(h.r.toFixed(4)),
      area: Number(h.area.toFixed(4)),
      panelRow: h.panelRow,
      panelCol: h.panelCol,
      localCx: Number(h.localCx.toFixed(4)),
      localCy: Number(h.localCy.toFixed(4)),
    })),
  };
}

/** The generator recipe - reproduces the field exactly from parameters. */
export function toRecipe(field, meta = {}) {
  return {
    schema: 'veil.standard-pattern.v1',
    presetId: meta.presetId || null,
    presetName: meta.presetName || null,
    params: field.params,
    derived: {
      fieldW: field.fieldW,
      fieldH: field.fieldH,
      holes: field.stats.placed,
      openPct: Number(field.stats.openPct.toFixed(3)),
      dropped: field.stats.dropped,
      shrunk: field.stats.shrunk,
    },
  };
}

// --------------------------------------------------------- downloads ------

export function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** PNG via an offscreen canvas render of the SVG. */
export async function downloadPNG(field, filename, scalePxPerMm = 0.5) {
  const svg = toSVG(field, { showPanels: false });
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(field.fieldW * scalePxPerMm);
  canvas.height = Math.round(field.fieldH * scalePxPerMm);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = filename;
  a.click();
}
