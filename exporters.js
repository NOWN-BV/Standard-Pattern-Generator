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

const STD_LAYERS = new Set(['0', 'Panel_Boundary', 'THRU_CUT_PATTERN', 'PANEL_LABELS']);

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

function dxfTables(extraLayers = []) {
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
    // The panel geometry brings its own layer names - cut lines, bend lines,
    // whatever the part was drawn with. They are declared here so the file
    // opens with them intact rather than collapsed onto layer 0.
    ...extraLayers.flatMap((n) => layer(n, 7)),
    '0',
    'ENDTAB',
    '0',
    'ENDSEC',
  ];
}

// ----------------------------------------------------- panel geometry ------
//
// DXF_BUILDER.md always said the cut and bend layers "live in the separate
// panel-geometry DXFs and are merged by a later stage". This is that stage:
// the flat pattern of the real part - its outer profile, its interior
// cutouts, its bend lines - carried into the same file as the perforation,
// instead of a 600 x 1200 rectangle standing in for a panel that actually has
// returns and notches.
//
// The file is read, not trusted. Only the entity types R12 can express are
// carried over, and whatever is left is COUNTED AND REPORTED rather than
// dropped quietly: a cut file silently missing a profile is the one failure
// this must not have.

/** (code, value) pairs, which is all a DXF is. */
function dxfPairs(text) {
  const t = String(text).split(/\r?\n/);
  const out = [];
  for (let i = 0; i + 1 < t.length; i += 2) out.push([t[i].trim(), t[i + 1]]);
  return out;
}

/**
 * Entities from a panel-geometry DXF, in a normal form the writer below can
 * emit. LWPOLYLINE is folded into POLYLINE because R12 has no LWPOLYLINE, and
 * an old POLYLINE / VERTEX / SEQEND run is regrouped into one entity. Bulges
 * ride along on the vertex, so an arc inside a profile survives the trip.
 */
export function parsePanelGeo(text, opts = {}) {
  const p = dxfPairs(text);
  // WHAT THE FILE SAYS ITS OWN DRAWING IS.
  //
  // $EXTMIN / $EXTMAX are the extents the CAD app last computed. A file can
  // carry stray geometry outside them - a mirrored construction copy left in
  // model space, say - and merging that would stamp it onto every panel, tens
  // of metres away, silently wrecking the sheet. So they are read, compared,
  // and any disagreement is REPORTED. Dropping only happens when asked.
  let headerBbox = null;
  {
    const at = (name) => {
      for (let i = 0; i < p.length; i++)
        if (p[i][0] === '9' && p[i][1].trim() === name) {
          const g = (code) => {
            for (let k = i + 1; k < Math.min(i + 8, p.length); k++)
              if (p[k][0] === code) return Number(p[k][1]);
            return NaN;
          };
          return { x: g('10'), y: g('20') };
        }
      return null;
    };
    const lo = at('$EXTMIN');
    const hi = at('$EXTMAX');
    if (lo && hi && Number.isFinite(lo.x) && Number.isFinite(hi.x) && hi.x > lo.x)
      headerBbox = { minX: lo.x, minY: lo.y, maxX: hi.x, maxY: hi.y };
  }
  const out = [];
  const skipped = {};
  const layers = new Set();
  const num = (v) => Number(v);
  let sec = null;
  let i = 0;
  while (i < p.length) {
    const [c, v] = p[i];
    if (c === '0' && v === 'SECTION') {
      sec = p[i + 1] && p[i + 1][0] === '2' ? p[i + 1][1] : null;
      i += 2;
      continue;
    }
    if (c === '0' && v === 'ENDSEC') {
      sec = null;
      i += 1;
      continue;
    }
    if (sec !== 'ENTITIES' || c !== '0') {
      i += 1;
      continue;
    }
    const type = v;
    const codes = [];
    let j = i + 1;
    for (; j < p.length && p[j][0] !== '0'; j++) codes.push(p[j]);
    const get = (k) => {
      const f = codes.find((e) => e[0] === k);
      return f ? f[1] : undefined;
    };
    const layer = get('8') ?? '0';
    if (type === 'LINE') {
      layers.add(layer);
      out.push({
        kind: 'line',
        layer,
        x1: num(get('10')),
        y1: num(get('20')),
        x2: num(get('11')),
        y2: num(get('21')),
      });
      i = j;
    } else if (type === 'CIRCLE') {
      layers.add(layer);
      out.push({ kind: 'circle', layer, cx: num(get('10')), cy: num(get('20')), r: num(get('40')) });
      i = j;
    } else if (type === 'ARC') {
      layers.add(layer);
      out.push({
        kind: 'arc',
        layer,
        cx: num(get('10')),
        cy: num(get('20')),
        r: num(get('40')),
        a1: num(get('50')),
        a2: num(get('51')),
      });
      i = j;
    } else if (type === 'LWPOLYLINE') {
      layers.add(layer);
      // 10 / 20 alternate per vertex; a 42 belongs to the vertex it follows.
      const verts = [];
      let vx = null;
      for (const [cc, vv] of codes) {
        if (cc === '10') {
          if (vx) verts.push(vx);
          vx = [num(vv), 0, 0];
        } else if (cc === '20' && vx) vx[1] = num(vv);
        else if (cc === '42' && vx) vx[2] = num(vv);
      }
      if (vx) verts.push(vx);
      out.push({ kind: 'poly', layer, verts, closed: (Number(get('70')) | 0) & 1 });
      i = j;
    } else if (type === 'POLYLINE') {
      layers.add(layer);
      const closed = (Number(get('70')) | 0) & 1;
      const verts = [];
      let k = j;
      while (k < p.length && p[k][0] === '0' && p[k][1] === 'VERTEX') {
        const vc = [];
        let m = k + 1;
        for (; m < p.length && p[m][0] !== '0'; m++) vc.push(p[m]);
        const vg = (kk) => {
          const f = vc.find((e) => e[0] === kk);
          return f ? num(f[1]) : 0;
        };
        verts.push([vg('10'), vg('20'), vg('42')]);
        k = m;
      }
      if (k < p.length && p[k][0] === '0' && p[k][1] === 'SEQEND') {
        let m = k + 1;
        for (; m < p.length && p[m][0] !== '0'; m++);
        k = m;
      }
      out.push({ kind: 'poly', layer, verts, closed });
      i = k;
    } else {
      // Anything R12 cannot hold: SPLINE, ELLIPSE, INSERT, HATCH, 3D solids.
      if (type !== 'SEQEND' && type !== 'VERTEX') skipped[type] = (skipped[type] ?? 0) + 1;
      i = j;
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const see = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  // AN ARC IS NOT ITS CIRCLE.
  //
  // Taking the full circle for an arc looks harmless until a file contains one
  // shallow arc of a large radius - a slightly crowned edge, say - and the
  // bounding box jumps to a hundred metres, which then throws every bbox and
  // centred alignment completely off. Only the swept part counts: the two
  // endpoints, plus whichever of the four cardinal points the sweep passes.
  const arcSee = (e) => arcSee2(e, see);
  for (const e of out) {
    if (e.kind === 'line') {
      see(e.x1, e.y1);
      see(e.x2, e.y2);
    } else if (e.kind === 'poly') {
      for (const vv of e.verts) see(vv[0], vv[1]);
    } else if (e.kind === 'arc') {
      arcSee(e);
    } else {
      see(e.cx - e.r, e.cy - e.r);
      see(e.cx + e.r, e.cy + e.r);
    }
  }
  // Anything living wholly outside the file's declared extents is stray.
  let outside = 0;
  let kept = out;
  if (headerBbox) {
    const pad = 1e-6;
    const inside = (e) => {
      let a = Infinity;
      let b = -Infinity;
      let c = Infinity;
      let d = -Infinity;
      const s = (x, y) => {
        if (x < a) a = x;
        if (x > b) b = x;
        if (y < c) c = y;
        if (y > d) d = y;
      };
      if (e.kind === 'line') {
        s(e.x1, e.y1);
        s(e.x2, e.y2);
      } else if (e.kind === 'poly') {
        for (const vv of e.verts) s(vv[0], vv[1]);
      } else if (e.kind === 'arc') {
        arcSee2(e, s);
      } else {
        s(e.cx - e.r, e.cy - e.r);
        s(e.cx + e.r, e.cy + e.r);
      }
      return (
        b >= headerBbox.minX - pad &&
        a <= headerBbox.maxX + pad &&
        d >= headerBbox.minY - pad &&
        c <= headerBbox.maxY + pad
      );
    };
    const within = out.filter(inside);
    outside = out.length - within.length;
    if (outside && opts.dropOutside) kept = within;
  }
  if (kept !== out) {
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    for (const e of kept) {
      if (e.kind === 'line') {
        see(e.x1, e.y1);
        see(e.x2, e.y2);
      } else if (e.kind === 'poly') {
        for (const vv of e.verts) see(vv[0], vv[1]);
      } else if (e.kind === 'arc') {
        arcSee(e);
      } else {
        see(e.cx - e.r, e.cy - e.r);
        see(e.cx + e.r, e.cy + e.r);
      }
    }
  }
  const usedLayers = new Set(kept.map((e) => e.layer));
  return {
    entities: kept,
    layers: [...layers].filter((n) => usedLayers.has(n)),
    skipped,
    headerBbox,
    outside,
    bbox: kept.length ? { minX, minY, maxX, maxY } : null,
  };
}

/** The swept extent of an arc, reported through a caller's `see`. */
function arcSee2(e, see) {
  const rad = (d) => (d * Math.PI) / 180;
  const norm = (d) => ((d % 360) + 360) % 360;
  const a1 = norm(e.a1);
  const a2 = norm(e.a2);
  const span = norm(a2 - a1) || (e.a1 === e.a2 ? 0 : 360);
  see(e.cx + e.r * Math.cos(rad(a1)), e.cy + e.r * Math.sin(rad(a1)));
  see(e.cx + e.r * Math.cos(rad(a2)), e.cy + e.r * Math.sin(rad(a2)));
  for (const c of [0, 90, 180, 270])
    if (norm(c - a1) <= span) see(e.cx + e.r * Math.cos(rad(c)), e.cy + e.r * Math.sin(rad(c)));
}

/**
 * Where the geometry's own origin lands inside the panel's box.
 *   'origin' - as drawn, which is what a file prepared on the module's own
 *              frame needs, and the only one that cannot silently disguise a
 *              file drawn at the wrong scale.
 *   'bbox'   - its bounding box's lower-left onto the panel's lower-left.
 *   'center' - its bounding box centred on the panel.
 * `dx` / `dy` shift it further, in mm, after whichever applied.
 */
export function panelGeoOffset(geo, align = 'origin', dx = 0, dy = 0) {
  const b = geo.bbox;
  if (!b || align === 'origin') return { ox: dx, oy: dy };
  if (align === 'bbox') return { ox: dx - b.minX, oy: dy - b.minY };
  return {
    ox: dx + (PANEL.moduleW - (b.maxX - b.minX)) / 2 - b.minX,
    oy: dy + (PANEL.moduleH - (b.maxY - b.minY)) / 2 - b.minY,
  };
}

/** One panel's worth of that geometry, translated, as R12 entity codes. */
function panelGeoCodes(geo, ox, oy) {
  const out = [];
  for (const e of geo.entities) {
    if (e.kind === 'line') {
      out.push(
        '0', 'LINE', '8', e.layer,
        '10', f3(e.x1 + ox), '20', f3(e.y1 + oy), '30', '0.0',
        '11', f3(e.x2 + ox), '21', f3(e.y2 + oy), '31', '0.0'
      );
    } else if (e.kind === 'circle') {
      out.push(
        '0', 'CIRCLE', '8', e.layer,
        '10', f3(e.cx + ox), '20', f3(e.cy + oy), '30', '0.0',
        '40', f3(e.r)
      );
    } else if (e.kind === 'arc') {
      out.push(
        '0', 'ARC', '8', e.layer,
        '10', f3(e.cx + ox), '20', f3(e.cy + oy), '30', '0.0',
        '40', f3(e.r), '50', f3(e.a1), '51', f3(e.a2)
      );
    } else {
      out.push('0', 'POLYLINE', '8', e.layer, '66', '1', '70', e.closed ? '1' : '0',
        '10', '0.0', '20', '0.0', '30', '0.0');
      for (const vv of e.verts) {
        out.push('0', 'VERTEX', '8', e.layer,
          '10', f3(vv[0] + ox), '20', f3(vv[1] + oy), '30', '0.0');
        if (vv[2]) out.push('42', f3(vv[2]));
      }
      out.push('0', 'SEQEND', '8', e.layer);
    }
  }
  return out;
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
  // The real part, if one was supplied, under the perforation.
  const pg = meta.panelGeo;
  const geo = pg && pg.dxf ? parsePanelGeo(pg.dxf, { dropOutside: pg.dropOutside !== false }) : null;
  const geoOff = geo ? panelGeoOffset(geo, pg.align, pg.dx ?? 0, pg.dy ?? 0) : null;

  const { cols, rows } = field.params;
  const PW = PANEL.moduleW;
  const PH = PANEL.moduleH;
  const SX = PW + PANEL.exportGap;
  const SY = PH + PANEL.exportGap;

  const ents = [];
  for (const pn of field.panels) {
    const bx = pn.col * SX;
    const by = (rows - 1 - pn.row) * SY;
    // The boundary rectangle is a reference, not a cutter, so it stays even
    // when real geometry is present - unless told to stand down, which is what
    // a file that already draws its own outline wants.
    if (!geo || pg.keepBoundary !== false)
      ents.push(
        ...polyline('Panel_Boundary', [
          [bx, by],
          [bx + PW, by],
          [bx + PW, by + PH],
          [bx, by + PH],
        ])
      );
    if (geo) ents.push(...panelGeoCodes(geo, bx + geoOff.ox, by + geoOff.oy));
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
    ...dxfTables(geo ? geo.layers.filter((n) => !STD_LAYERS.has(n)) : []),
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
