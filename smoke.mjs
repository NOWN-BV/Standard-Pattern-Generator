// prototypes/veil-standard-pattern/smoke.mjs
// Node smoke test for the standard-pattern core + writers. No browser needed.
//   node prototypes/veil-standard-pattern/smoke.mjs
//
// Guards the two invariants that matter for this product:
//   1. CONTINUITY - with modScope='locked', extending the run leaves every
//      already-placed hole bit-identical. That is what makes a run extendable.
//   2. FABRICABILITY - no hole below MIN_HOLE_DIA, above MAX_HOLE_DIA, under
//      MIN_PERF_AREA, or inside the edge keep-out.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildField,
  LIMITS,
  PANEL,
  quantileRank,
  tileLabelFor,
  driverPeriod,
} from './pattern-core.js';
import { PRESETS } from './presets.js';
import { shapeVerts, flattenBulges } from './shape-paths.js';
import {
  toDXF,
  panelHoles,
  toSVG,
  toPayload,
  toRecipe,
  parsePanelGeo,
} from './exporters.js';

const key = (h) => `${h.panelCol}:${h.cx.toFixed(6)},${h.cy.toFixed(6)},${h.r.toFixed(6)}`;

// -- 1. continuity ---------------------------------------------------------
{
  const a = buildField({ cols: 4 });
  const b = buildField({ cols: 5 });
  const A = a.holes.map(key).join('|');
  const B = b.holes
    .filter((h) => h.panelCol < 4)
    .map(key)
    .join('|');
  assert.equal(A, B, 'locked ramp must not move existing holes when a panel is added');
  assert.ok(a.holes.length > 0);

  // Horizontal ramp: the axis that actually changes length when a panel is
  // added. (A vertical ramp on a 1-row run is unaffected either way.)
  const c = buildField({ cols: 4, modScope: 'run', modAngle: 0 });
  const d = buildField({ cols: 5, modScope: 'run', modAngle: 0 });
  assert.notEqual(
    c.holes.map(key).join('|'),
    d.holes
      .filter((h) => h.panelCol < 4)
      .map(key)
      .join('|'),
    "modScope='run' is expected to restretch the ramp - if this passes, the two modes are the same and one is dead code"
  );
}

// -- 2. fabricability across every preset ----------------------------------
for (const preset of PRESETS) {
  const f = buildField({ ...preset.params });
  assert.ok(f.holes.length > 0, `${preset.id}: produced no holes`);
  for (const h of f.holes) {
    assert.ok(h.r * 2 >= LIMITS.minDia - 1e-9, `${preset.id}: hole under min dia`);
    assert.ok(h.r * 2 <= LIMITS.maxDia + 1e-9, `${preset.id}: hole over max dia`);
    assert.ok(h.area >= LIMITS.minPerfArea, `${preset.id}: hole under min perf area`);
    // NO EDGE KEEP-OUT. A hole may straddle a panel edge or a joint: the
    // panels butt together, so the two halves meet and the pattern continues
    // across. What must hold is that the centre stays inside its own panel.
    const pn = f.panels.find((p) => p.col === h.panelCol && p.row === h.panelRow);
    assert.ok(
      h.cx >= pn.x - 1e-6 && h.cx <= pn.x + pn.w + 1e-6,
      `${preset.id}: hole centre outside its panel in x`
    );
    assert.ok(
      h.cy >= pn.y - 1e-6 && h.cy <= pn.y + pn.h + 1e-6,
      `${preset.id}: hole centre outside its panel in y`
    );
  }
  console.log(
    preset.id.padEnd(17),
    String(f.stats.placed).padStart(6),
    'holes',
    `${f.stats.openPct.toFixed(2)}%`.padStart(7),
    'open   dropped',
    String(f.stats.dropped).padStart(4),
    'shrunk',
    f.stats.shrunk
  );
}

// -- 3. writers ------------------------------------------------------------
{
  const f = buildField({});
  const dxf = toDXF(f, {});
  assert.ok(dxf.startsWith('0\r\nSECTION'), 'DXF must open with a SECTION');
  assert.ok(dxf.trimEnd().endsWith('EOF'), 'DXF must end with EOF');
  for (const layer of ['Panel_Boundary', 'THRU_CUT_PATTERN', 'PANEL_LABELS']) {
    assert.ok(dxf.includes(layer), `DXF missing layer ${layer}`);
  }
  const circles = (dxf.match(/\r\nCIRCLE\r\n/g) || []).length;
  // The DXF nests one sheet PER PANEL, so a hole centred on a joint is emitted
  // twice - once for each panel that has to cut its half. The count is therefore
  // the sum over panels of the holes each must cut, which is >= the number of
  // distinct holes in the field. Asserting equality against field.holes.length
  // is what let the missing-boundary-column bug through.
  const mustCut = f.panels.reduce((n, pn) => n + panelHoles(f, pn).length, 0);
  assert.equal(circles, mustCut, 'every panel must cut every hole that touches it');
  assert.ok(circles >= f.holes.length, 'nesting may duplicate shared holes, never lose them');
  // And every panel must carry holes on both of its side edges.
  for (const pn of f.panels) {
    const mine = panelHoles(f, pn);
    const onLeft = mine.some((m) => Math.abs(m.lx) < 1e-6);
    const onRight = mine.some((m) => Math.abs(m.lx - PANEL.moduleW) < 1e-6);
    assert.ok(onLeft && onRight, `panel ${pn.label}: pattern does not reach both side edges`);
  }
  assert.ok(dxf.includes('AC1009'), 'DXF must be R12');

  const svg = toSVG(f);
  assert.ok(svg.includes('<svg') && svg.includes('</svg>'));

  const pay = toPayload(f, {});
  assert.equal(pay.schema, 'veil.spectral.v1');
  assert.equal(pay.shapes.length, f.holes.length);
  assert.match(pay.designId, /^VEIL-[A-Z]{2}-\d{4}$/);
  assert.ok(['grid', 'stagger', 'hex', 'radial'].includes(pay.pattern.patternType));

  const rec = toRecipe(f, {});
  const rebuilt = buildField(rec.params);
  assert.equal(
    rebuilt.holes.map(key).join('|'),
    f.holes.map(key).join('|'),
    'recipe must be reproducible'
  );

  console.log(
    '\nwriters ok - dxf',
    dxf.length,
    'bytes, svg',
    svg.length,
    'bytes, payload',
    pay.shapes.length,
    'shapes'
  );
}

// -- 4. non-circular shapes still export -----------------------------------
// Thin shapes (slot, cross, triangle) enclose far less area per unit extent,
// so they need a larger diameter to clear the MIN_PERF_AREA floor. That is
// the real fabrication constraint, not a bug - hence the 40mm extent here.
for (const shape of ['hex', 'square', 'slot', 'star', 'cross', 'triangle', 'diamond', 'organic']) {
  const f = buildField({
    shape,
    cols: 2,
    pitch: 50,
    minDia: 40,
    maxDia: 40,
    modulation: 'uniform',
  });
  const dxf = toDXF(f, {});
  assert.ok(f.holes.length > 0, `${shape}: no holes`);
  assert.ok(dxf.includes('POLYLINE'), `${shape}: expected POLYLINE entities`);
}

// -- 5. the area floor is enforced, not silently ignored -------------------
{
  const tooThin = buildField({ shape: 'slot', minDia: 10, maxDia: 10, modulation: 'uniform' });
  assert.equal(tooThin.holes.length, 0, 'a 10mm slot is under MIN_PERF_AREA and must not be cut');
  assert.ok(tooThin.stats.dropped > 0, 'dropped count must report why the field is empty');
}

console.log('all smoke checks passed');

// -- P4 panels must be ONE part ------------------------------------------
// Every panel under P4 has to be byte-identical: same hole positions, same
// radii. Anything else means the wall needs more than one part to build, and
// the boundaries stop matching exactly. This has broken three separate ways -
// mirrored sampling, float dust at the seam, and dust in the size field - so
// it is asserted across every driver / cull combination rather than spot-checked.
{
  const e = 1e-6;
  const sheet = (f, pn) =>
    f.holes
      .filter(
        (h) =>
          h.cx >= pn.x - e &&
          h.cx <= pn.x + PANEL.moduleW + e &&
          h.cy >= pn.y - e &&
          h.cy <= pn.y + PANEL.moduleH + e
      )
      .map(
        (h) =>
          `${Math.round((h.cx - pn.x) * 1000)},${Math.round((h.cy - pn.y) * 1000)},${Math.round(h.r * 10000)}`
      )
      .sort()
      .join('|');
  const COMBOS = [
    ['uniform', { modulation: 'uniform' }],
    ['scatter cull', { modulation: 'uniform', cull: 45 }],
    ['clouds cull', { modulation: 'uniform', cull: 45, cullShape: 'clouds' }],
    ['noise + contrast', { modulation: 'noise', wavelength: 300, sizeContrast: 100 }],
    [
      'noise + cull + fade',
      { modulation: 'noise', wavelength: 300, sizeContrast: 100, cull: 45, cullShape: 'clouds', cullFade: 30 },
    ],
    ['linear + gradient cull', { modulation: 'linear', modAngle: 0, cull: 40, cullMode: 'gradient' }],
    ['radial + cull', { modulation: 'radial', sizeContrast: 80, cull: 35, cullShape: 'clouds' }],
    ['bands + fade', { modulation: 'bands', steps: 5, cull: 40, cullShape: 'clouds', cullFade: 50 }],
  ];
  for (const [label, over] of COMBOS) {
    const f = buildField({ cols: 4, rows: 2, tiling: 'P4', pitch: 40, minDia: 9, maxDia: 30, ...over });
    const distinct = new Set(f.panels.map((pn) => sheet(f, pn)));
    // P4 is FOUR different tiles - that is the point of it. What must hold is
    // that every panel edge carries the IDENTICAL column, so the tiles butt
    // together in any order. "One part" was the previous requirement and is
    // now the wrong thing to assert.
    assert.ok(distinct.size >= 1, `P4 produced no panels for: ${label}`);
    const edgeVariants = (side) =>
      new Set(
        f.panels.map((pn) => {
          const ex = side === 'L' ? pn.x : pn.x + PANEL.moduleW;
          return f.holes
            .filter(
              (h) =>
                Math.abs(h.cx - ex) < e &&
                h.cy >= pn.y - e &&
                h.cy <= pn.y + PANEL.moduleH + e
            )
            .sort((m, n) => m.cy - n.cy)
            .map((h) => Math.round((h.cy - pn.y) * 1000) + ',' + Math.round(h.r * 10000))
            .join('|');
        })
      ).size;
    assert.equal(edgeVariants('L'), 1, `left edges must match across tiles for: ${label}`);
    assert.equal(edgeVariants('R'), 1, `right edges must match across tiles for: ${label}`);
    assert.ok(f.stats.tilesInterchangeable, `boundaries must match for: ${label}`);
  }
  console.log('P4 tiles differ with matching edges across', COMBOS.length, 'combinations');
}

// -- panel geometry merge ---------------------------------------------------
//
// The merge has to do three things or it is worse than not existing: carry
// every entity onto every panel, keep the source layer names, and emit only
// what R12 can hold. A dropped profile in a cut file is scrap metal.
{
  const geoDxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'BEND', '10', '0.0', '20', '20.0', '30', '0.0',
    '11', '600.0', '21', '20.0', '31', '0.0',
    '0', 'LWPOLYLINE', '8', 'OUTER_PROFILES', '70', '1',
    '10', '0.0', '20', '0.0', '10', '600.0', '20', '0.0',
    '10', '600.0', '20', '1200.0', '10', '0.0', '20', '1200.0',
    '0', 'CIRCLE', '8', 'FIXINGS', '10', '50.0', '20', '50.0', '30', '0.0', '40', '4.0',
    '0', 'SPLINE', '8', 'IGNORED',
    '0', 'ENDSEC', '0', 'EOF',
  ].join('\r\n');

  const geo = parsePanelGeo(geoDxf);
  assert.equal(geo.entities.length, 3, 'line + polyline + circle should parse');
  assert.deepEqual(geo.layers, ['BEND', 'OUTER_PROFILES', 'FIXINGS']);
  assert.equal(geo.skipped.SPLINE, 1, 'a SPLINE has no R12 form and must be REPORTED');
  assert.deepEqual(geo.bbox, { minX: 0, minY: 0, maxX: 600, maxY: 1200 });

  const cols = 3;
  const rows = 2;
  const field = buildField({ cols, rows });
  const plain = toDXF(field, {});
  const merged = toDXF(field, { panelGeo: { dxf: geoDxf, align: 'origin' } });
  const n = (s, t) => (s.match(new RegExp('^' + t + '$', 'gm')) || []).length;

  // once per panel, not once per file
  assert.equal(n(merged, 'LINE') - n(plain, 'LINE'), cols * rows, 'one bend line per panel');
  assert.equal(n(merged, 'CIRCLE') - n(plain, 'CIRCLE'), cols * rows, 'one fixing per panel');
  assert.equal(
    n(merged, 'POLYLINE') - n(plain, 'POLYLINE'),
    cols * rows,
    'one profile per panel'
  );
  // R12 has no LWPOLYLINE; it must have been folded into POLYLINE
  assert.ok(!merged.includes('LWPOLYLINE'), 'R12 output must not contain LWPOLYLINE');
  for (const layer of ['BEND', 'OUTER_PROFILES', 'FIXINGS'])
    assert.ok(
      merged.includes('\r\n' + layer + '\r\n'),
      `source layer ${layer} must be declared, not collapsed onto 0`
    );
  // the boundary rectangle can stand down for a file that draws its own
  const noBox = toDXF(field, { panelGeo: { dxf: geoDxf, keepBoundary: false } });
  assert.equal(n(noBox, 'POLYLINE'), n(merged, 'POLYLINE') - cols * rows);
  // and nothing changes when no geometry is supplied
  assert.equal(plain, toDXF(field, {}), 'export without geometry must be unchanged');

  console.log(
    'panel geometry merges onto',
    cols * rows,
    'panels, layers kept, SPLINE reported not swallowed'
  );
}

// -- panel geometry: arcs, extents and strays -------------------------------
//
// Three ways this quietly goes wrong on a real CAD export, all found on one:
// a shallow arc of a large radius blowing the bounding box up to a hundred
// metres, a mirrored construction copy left in model space, and the file's own
// declared extents disagreeing with what is actually in it.
{
  // an arc sweeping 0 -> 90 of radius 100 about the origin reaches (100,100),
  // NOT (-100,-100): its circle is not its extent.
  const arcDxf = [
    '0', 'SECTION', '2', 'HEADER',
    '9', '$EXTMIN', '10', '0.0', '20', '0.0', '30', '0.0',
    '9', '$EXTMAX', '10', '100.0', '20', '100.0', '30', '0.0',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'ARC', '8', 'GEOMETRY', '10', '0.0', '20', '0.0', '30', '0.0',
    '40', '100.0', '50', '0.0', '51', '90.0',
    // stray: a mirrored copy far outside the declared extents
    '0', 'LINE', '8', 'GEOMETRY', '10', '-9000.0', '20', '0.0', '30', '0.0',
    '11', '-8900.0', '21', '0.0', '31', '0.0',
    '0', 'ENDSEC', '0', 'EOF',
  ].join('\r\n');

  const loose = parsePanelGeo(arcDxf);
  assert.equal(loose.outside, 1, 'the stray must be COUNTED even when it is kept');
  assert.equal(loose.entities.length, 2, 'nothing is dropped unless asked');
  assert.ok(loose.bbox.minX < -8000, 'kept stray must show in the bbox');

  const tight = parsePanelGeo(arcDxf, { dropOutside: true });
  assert.equal(tight.entities.length, 1, 'the stray drops when asked');
  assert.equal(tight.outside, 1, 'and is still reported after dropping');
  // the arc alone: 0..100 both ways, not -100..100
  assert.ok(Math.abs(tight.bbox.minX - 0) < 1e-6, 'arc bbox must use the SWEPT arc');
  assert.ok(Math.abs(tight.bbox.maxX - 100) < 1e-6);
  assert.ok(Math.abs(tight.bbox.minY - 0) < 1e-6);
  assert.ok(Math.abs(tight.bbox.maxY - 100) < 1e-6);
  assert.deepEqual(tight.headerBbox, { minX: 0, minY: 0, maxX: 100, maxY: 100 });

  // toDXF drops strays by default, so one bad file cannot blow up a sheet
  const field = buildField({ cols: 1, rows: 1 });
  const out = toDXF(field, { panelGeo: { dxf: arcDxf, align: 'center' } });
  assert.equal((out.match(/^ARC$/gm) || []).length, 1, 'the arc is carried');
  assert.equal((out.match(/^LINE$/gm) || []).length, 0, 'the stray is not');

  console.log('panel geometry: arc extents swept, strays counted and dropped by default');
}

// -- panel geometry: extrusion direction ------------------------------------
//
// A 2D entity is drawn in its own plane and 210/220/230 says which way that
// plane faces. CAD writes (0,0,-1) for anything on a mirrored plane, and its
// x is then measured the other way. Ignoring it put 55 entities of a real part
// on the far side of the drawing, where they looked exactly like a stray
// mirrored copy - and were being dropped from the cut file as one.
{
  const mk = (extrude) =>
    [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', 'GEOMETRY', '10', '100.0', '20', '10.0', '30', '0.0',
      '11', '200.0', '21', '10.0', '31', '0.0',
      ...(extrude ? ['210', '0.0', '220', '0.0', '230', '-1.0'] : []),
      '0', 'ARC', '8', 'GEOMETRY', '10', '100.0', '20', '50.0', '30', '0.0',
      '40', '10.0', '50', '0.0', '51', '90.0',
      ...(extrude ? ['210', '0.0', '220', '0.0', '230', '-1.0'] : []),
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n');

  const plain = parsePanelGeo(mk(false));
  const flip = parsePanelGeo(mk(true));

  const line = (g) => g.entities.find((e) => e.kind === 'line');
  assert.equal(line(plain).x1, 100);
  assert.equal(line(flip).x1, -100, 'a mirrored plane measures x the other way');
  assert.equal(line(flip).x2, -200);
  assert.equal(line(flip).y1, 10, 'y is untouched');

  const arc = (g) => g.entities.find((e) => e.kind === 'arc');
  assert.equal(arc(flip).cx, -100, 'the centre flips with everything else');
  // x -> -x maps every angle to 180 - angle, which reverses the direction of
  // travel, so the ends swap: 0..90 becomes 90..180, not -0..-90.
  assert.equal(arc(flip).a1, 90);
  assert.equal(arc(flip).a2, 180);
  // and the swept extent must follow. Measured on the arc ALONE, because the
  // line above reaches further and would hide a wrong answer here.
  const arcOnly = parsePanelGeo(
    [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'ARC', '8', 'GEOMETRY', '10', '100.0', '20', '50.0', '30', '0.0',
      '40', '10.0', '50', '0.0', '51', '90.0',
      '210', '0.0', '220', '0.0', '230', '-1.0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n')
  );
  // 0..90 about (100,50) sweeps x 100..110; mirrored that is -110..-100.
  assert.ok(Math.abs(arcOnly.bbox.minX - -110) < 1e-6, 'mirrored arc sweeps the other way');
  assert.ok(Math.abs(arcOnly.bbox.maxX - -100) < 1e-6);
  assert.ok(Math.abs(arcOnly.bbox.maxY - 60) < 1e-6, 'y is unchanged by the mirror');

  console.log('panel geometry: mirrored extrusion planes read as world coordinates');
}

// -- transition panels ------------------------------------------------------
//
// A transition panel is specified by its ENDS: it butts against a standard
// panel of one hole size at one edge and another size at the other. If the end
// row is not exactly that size the joint shows, so this checks the shared row
// hole for hole against the standard fields either side - not that the ramp
// merely got close.
{
  const STD = {
    cols: 1, rows: 1, tiling: 'WALL', lattice: 'hex', pitch: 50, shape: 'circle',
    modulation: 'uniform', gamma: 1, sizeLevels: 1, sizeContrast: 0, cull: 0, taper: 0,
  };
  const row = (f, y) =>
    f.holes
      .filter((h) => Math.abs(h.cy - y) < 1e-6)
      .sort((a, b) => a.cx - b.cx)
      .map((h) => h.cx.toFixed(4) + '@' + (2 * h.r).toFixed(4))
      .join('|');

  const fine = buildField({ ...STD, minDia: 12.5, maxDia: 12.5 });
  const coarse = buildField({ ...STD, minDia: 25, maxDia: 25 });
  const trans = buildField({
    ...STD, minDia: 12.5, maxDia: 25, modulation: 'ramp', modAngle: 90, modScope: 'run',
  });

  assert.ok(row(trans, 0).length > 0, 'the transition must have a row on its top edge');
  assert.equal(row(trans, 0), row(fine, PANEL.moduleH), 'top edge must match the fine panel');
  assert.equal(row(trans, PANEL.moduleH), row(coarse, 0), 'bottom edge must match the coarse panel');

  // Every row an equal step: a ramp measured in millimetres stumbles on one row
  // whenever the span is not a whole number of rows.
  const stepsOf = (mod, spanMm) => {
    const f = buildField({
      ...STD, minDia: 12.5, maxDia: 25, modulation: mod, modAngle: 90,
      modScope: 'locked', spanMm, lattice: 'grid', latticeAspect: 100, pitch: 30,
    });
    const by = new Map();
    for (const h of f.holes) if (!by.has(+h.cy.toFixed(2))) by.set(+h.cy.toFixed(2), 2 * h.r);
    const ys = [...by.keys()].sort((a, b) => a - b);
    const d = [];
    for (let i = 1; i < ys.length; i++) {
      const step = by.get(ys[i]) - by.get(ys[i - 1]);
      if (step > 1e-9) d.push(+step.toFixed(2)); // ignore the flat clamped tail
    }
    return new Set(d).size;
  };
  assert.equal(stepsOf('ramp', 850), 1, 'ramp must step evenly however the span divides');
  assert.ok(stepsOf('linear', 850) > 1, 'if linear were also even, ramp would be dead weight');

  // WALL lays the design down once, so nothing may wrap: the final row used to
  // take the value belonging to the first.
  const wide = buildField({
    ...STD, cols: 3, minDia: 12.5, maxDia: 25, modulation: 'ramp', modAngle: 90, modScope: 'run',
  });
  const last = wide.holes.filter((h) => Math.abs(h.cy - PANEL.moduleH) < 1e-6);
  assert.ok(last.length > 0);
  for (const h of last)
    assert.ok(
      Math.abs(2 * h.r - 25) < 1e-6,
      'the last row of a multi-panel WALL run must not wrap to the first row value'
    );

  // A size the lattice cannot carry is reduced - that is right - but it must be
  // reported, because on a transition panel the end diameter IS the spec.
  const tight = buildField({
    ...STD, lattice: 'grid', latticeAspect: 70, pitch: 30, minDia: 12.5, maxDia: 25,
    modulation: 'ramp', modAngle: 90, modScope: 'run',
  });
  assert.equal(tight.stats.diaClamped, true, 'an unreachable end diameter must be flagged');
  assert.ok(tight.stats.diaCap < 25);
  assert.equal(trans.stats.diaClamped, false, 'and not flagged when it does fit');

  console.log('transition panel ends match the standard panels either side, hole for hole');
}

// -- a ramp is never wrapped ------------------------------------------------
//
// Every other driver is a pattern, and a pattern under P1/P4 has to meet itself
// at the joint, which is what wrapping the sample enforces. A ramp is a
// transition: it runs from one diameter to another and never butts against a
// copy of itself. Wrapping it put the first row's small holes along the bottom
// edge - the very seam the mode exists to remove - so the tiling must not
// reach it.
{
  const T = {
    cols: 1, rows: 1, lattice: 'hex', pitch: 50, shape: 'circle',
    minDia: 12.5, maxDia: 25, modulation: 'ramp', modAngle: 90, modScope: 'run',
    gamma: 1, sizeLevels: 1, sizeContrast: 0, cull: 0, taper: 0,
  };
  for (const tiling of ['WALL', 'P1', 'P4']) {
    for (const [cols, rows] of [[1, 1], [2, 2]]) {
      const f = buildField({ ...T, tiling, cols, rows });
      const ys = [...new Set(f.holes.map((h) => +h.cy.toFixed(4)))].sort((a, b) => a - b);
      const at = (y) => [
        ...new Set(f.holes.filter((h) => Math.abs(h.cy - y) < 1e-6).map((h) => +(2 * h.r).toFixed(4))),
      ];
      const top = at(ys[0]);
      const bot = at(ys[ys.length - 1]);
      const where = `${tiling} ${cols}x${rows}`;
      assert.deepEqual(top, [12.5], `${where}: top row must be the fine diameter`);
      assert.deepEqual(bot, [25], `${where}: bottom row must be the coarse diameter, not wrapped`);
      // and no row may be split - a wrapped sample shows up as two sizes in one row
      const rowsMap = new Map();
      for (const h of f.holes) {
        const k = +h.cy.toFixed(4);
        if (!rowsMap.has(k)) rowsMap.set(k, new Set());
        rowsMap.get(k).add(+(2 * h.r).toFixed(4));
      }
      for (const [y, set] of rowsMap)
        assert.equal(set.size, 1, `${where}: row at y=${y} carries ${set.size} different diameters`);
    }
  }
  console.log('a ramp reaches both end diameters under WALL, P1 and P4 alike');
}

// -- the size asked for is the size cut -------------------------------------
//
// Ranking a tie group by its first index over n cannot reach 1: the last group
// starts at n minus its own size. With contrast at 100 the largest holes
// therefore fell short of max dia - Basic-50-1225 asked for 25mm and cut
// 24.55 - across 43 of the saved designs, silently.
{
  // twenty values in four tie groups of five
  const vals = [];
  for (let g = 0; g < 4; g++) for (let k = 0; k < 5; k++) vals.push(g);
  const r = quantileRank(vals);
  assert.equal(Math.min(...r), 0, 'the smallest value must rank 0');
  assert.equal(Math.max(...r), 1, 'the largest value must rank 1');
  // ties still share, which is what keeps two panel edges agreeing
  for (let g = 0; g < 4; g++) {
    const seen = new Set();
    for (let k = 0; k < 5; k++) seen.add(r[g * 5 + k]);
    assert.equal(seen.size, 1, `tie group ${g} must share one rank`);
  }
  assert.ok(r[0] < r[5] && r[5] < r[10] && r[10] < r[15], 'and stay monotonic');

  // end to end: a contrast-100 gradient must reach both stated diameters
  const f = buildField({
    cols: 1, rows: 1, tiling: 'WALL', lattice: 'hex', pitch: 50, shape: 'circle',
    minDia: 12, maxDia: 25, modulation: 'linear', modAngle: 90, modScope: 'run',
    sizeContrast: 100, gamma: 1, sizeLevels: 1, cull: 0, taper: 0,
  });
  const ds = f.holes.map((h) => 2 * h.r);
  assert.ok(Math.abs(Math.max(...ds) - 25) < 1e-6, 'contrast must still reach max dia');
  assert.ok(Math.abs(Math.min(...ds) - 12) < 1e-6, 'and min dia');
  assert.equal(f.stats.diaShort, false, 'and must not report itself short');

  // and a ramp spanning twice the panel really is short - the report has to
  // fire, or the next one of these goes out in a DXF unnoticed
  const half = buildField({
    cols: 1, rows: 1, tiling: 'WALL', lattice: 'hex', pitch: 50, shape: 'circle',
    minDia: 12.5, maxDia: 25, modulation: 'ramp', modAngle: 90,
    modScope: 'locked', spanMm: 2400, sizeContrast: 0, gamma: 1, sizeLevels: 1, cull: 0, taper: 0,
  });
  assert.equal(half.stats.diaShort, true, 'a ramp longer than the panel must be reported short');
  assert.ok(half.stats.diaHigh < 25);

  console.log('sizes reach both stated diameters, and a short field says so');
}

// -- the ramp runs across as well as down -----------------------------------
//
// A staggered lattice offsets every other row by half a pitch, so along x the
// holes sit half a pitch apart. Counting whole cells rounded each offset hole
// onto its neighbour's index and the ramp came out in PAIRS of identical
// columns - a doubled column at every step, which is the same class of seam
// this mode exists to remove. Only the axis carrying the stagger is halved,
// and that axis is y on a transposed lattice.
{
  const B = {
    cols: 1, rows: 1, pitch: 50, shape: 'circle', minDia: 12.5, maxDia: 25,
    modulation: 'ramp', modScope: 'run', gamma: 1, sizeLevels: 1, sizeContrast: 0,
    cull: 0, taper: 0, tiling: 'WALL',
  };
  for (const lattice of ['grid', 'stagger', 'hex', 'hexV']) {
    for (const [angle, axis] of [[0, 'cx'], [90, 'cy'], [180, 'cx'], [270, 'cy']]) {
      const f = buildField({ ...B, lattice, modAngle: angle });
      const g = new Map();
      for (const h of f.holes) {
        const k = +h[axis].toFixed(4);
        if (!g.has(k)) g.set(k, new Set());
        g.get(k).add(+(2 * h.r).toFixed(4));
      }
      const keys = [...g.keys()].sort((a, b) => a - b);
      const where = `${lattice} @${angle}`;
      // one size per line across the ramp
      for (const [k, set] of g)
        assert.equal(set.size, 1, `${where}: ${axis}=${k} carries ${set.size} sizes`);
      // both ends exact, whichever way round
      const lo = [...g.get(keys[0])][0];
      const hi = [...g.get(keys[keys.length - 1])][0];
      const back = angle === 180 || angle === 270;
      assert.equal(back ? hi : lo, 12.5, `${where}: near end must be min dia`);
      assert.equal(back ? lo : hi, 25, `${where}: far end must be max dia`);
      // and no two neighbouring lines may share a size - that is the doubled
      // column the half-pitch offset used to produce
      const vals = keys.map((k) => [...g.get(k)][0]);
      for (let i = 1; i < vals.length; i++)
        assert.notEqual(vals[i], vals[i - 1], `${where}: two adjacent lines share a size`);
    }
  }
  console.log('the ramp runs cleanly along either axis on every lattice');
}

// -- the corner that joins an across run to a down run ----------------------
//
// A straight ramp makes every column one size running across, or every row one
// size running down, so the two runs cannot butt together. Taking the larger of
// the two counts turns the gradient through the corner: along the top edge the
// down term is zero so it IS the across ramp, and along the left edge the
// across term is zero so it IS the down ramp. That is the join, and it is
// asserted hole for hole rather than eyeballed.
{
  const B = {
    cols: 1, rows: 1, pitch: 50, lattice: 'hex', shape: 'circle',
    minDia: 12.5, maxDia: 25, modulation: 'ramp', modScope: 'run',
    gamma: 1, sizeLevels: 1, sizeContrast: 0, cull: 0, taper: 0, tiling: 'WALL',
  };
  const edge = (f, which) => {
    const xs = [...new Set(f.holes.map((h) => +h.cx.toFixed(3)))].sort((a, b) => a - b);
    const ys = [...new Set(f.holes.map((h) => +h.cy.toFixed(3)))].sort((a, b) => a - b);
    const pick = {
      top: (h) => Math.abs(h.cy - ys[0]) < 1e-6,
      bottom: (h) => Math.abs(h.cy - ys[ys.length - 1]) < 1e-6,
      left: (h) => Math.abs(h.cx - xs[0]) < 1e-6,
      right: (h) => Math.abs(h.cx - xs[xs.length - 1]) < 1e-6,
    }[which];
    const key = which === 'top' || which === 'bottom' ? 'cx' : 'cy';
    return f.holes.filter(pick).sort((a, b) => a[key] - b[key])
      .map((h) => h[key].toFixed(3) + '@' + (2 * h.r).toFixed(4)).join('|');
  };
  const across = buildField({ ...B, modAngle: 0 });
  const down = buildField({ ...B, modAngle: 90 });
  const corner = buildField({ ...B, modAngle: 45, rampCorner: true });

  assert.equal(edge(across, 'bottom'), edge(corner, 'top'), 'an across panel must sit above it');
  assert.equal(edge(down, 'right'), edge(corner, 'left'), 'a down panel must sit beside it');
  // the far edges are where the gradient has finished, so they are all max dia
  for (const side of ['right', 'bottom'])
    for (const part of edge(corner, side).split('|'))
      assert.equal(part.split('@')[1], '25.0000', `corner ${side} edge must have finished`);

  // Without the corner switch a ramp runs along one axis - there is no
  // diagonal. 45 therefore behaves as across, which is what it is nearest.
  const diag = buildField({ ...B, modAngle: 45 });
  assert.equal(edge(diag, 'top'), edge(across, 'top'), '45 without the corner is the across ramp');
  for (const side of ['left', 'right'])
    for (const part of edge(diag, side).split('|'))
      assert.ok(/@(12.5000|25.0000)$/.test(part), 'and its side edges stay flat');

  // and the pure axes are untouched by either addition
  for (const angle of [0, 90, 180, 270]) {
    const a = buildField({ ...B, modAngle: angle });
    const lines = new Map();
    const key = angle % 180 === 0 ? 'cx' : 'cy';
    for (const h of a.holes) {
      const k = +h[key].toFixed(4);
      if (!lines.has(k)) lines.set(k, new Set());
      lines.get(k).add(+(2 * h.r).toFixed(4));
    }
    for (const [, set] of lines) assert.equal(set.size, 1, `@${angle} must stay a pure ramp`);
  }
  console.log('the corner hands off to an across run above it and a down run beside it');
}

// -- a fade panel must land on the stated small size ------------------------
//
// The fade walked toward the product floor, so a design stating 12.5 as its
// small end faded to 12 - and a fade panel that ends at 12 cannot meet the
// 12.5 field it butts against. A design that states a size RANGE has already
// said where its small end is. Only a uniform one has not, and there fading
// toward min dia would do nothing, so the floor still applies.
{
  const B = {
    cols: 1, rows: 1, pitch: 50, lattice: 'stagger', shape: 'circle',
    minDia: 12.5, maxDia: 35, modulation: 'lattice', crossKx: 1, crossKy: 2,
    crossSharp: 0, wavelength: 420, modAngle: 45, modScope: 'run', tiling: 'P1',
    gamma: 1, sizeLevels: 1, sizeContrast: 0, cull: 0, tiling: 'WALL',
  };
  const fade = (angle) => ({
    ...B, taper: 100, taperTarget: 'size', taperDriver: 'ramp',
    taperScope: 'wall', taperDir: '', taperAngle: angle,
  });
  const edge = (f, which) => {
    const xs = [...new Set(f.holes.map((h) => +h.cx.toFixed(3)))].sort((a, b) => a - b);
    const ys = [...new Set(f.holes.map((h) => +h.cy.toFixed(3)))].sort((a, b) => a - b);
    const pick = {
      top: (h) => Math.abs(h.cy - ys[0]) < 1e-6,
      bottom: (h) => Math.abs(h.cy - ys[ys.length - 1]) < 1e-6,
      left: (h) => Math.abs(h.cx - xs[0]) < 1e-6,
      right: (h) => Math.abs(h.cx - xs[xs.length - 1]) < 1e-6,
    }[which];
    const key = which === 'top' || which === 'bottom' ? 'cx' : 'cy';
    return f.holes.filter(pick).sort((a, b) => a[key] - b[key])
      .map((h) => h[key].toFixed(3) + '@' + (2 * h.r).toFixed(4)).join('|');
  };
  const board = buildField(B);
  const plain = buildField({ ...B, modulation: 'uniform', maxDia: 12.5, taper: 0 });

  for (const [angle, inner, outer] of [
    [0, 'left', 'right'], [180, 'right', 'left'],
    [90, 'top', 'bottom'], [270, 'bottom', 'top'],
  ]) {
    const f = buildField(fade(angle));
    assert.equal(edge(f, inner), edge(board, inner), `@${angle}: inner edge must meet the board`);
    assert.equal(edge(f, outer), edge(plain, outer), `@${angle}: outer edge must meet the plain field`);
    for (const part of edge(f, outer).split('|'))
      assert.ok(part.endsWith('@12.5000'), `@${angle}: outer edge must be exactly the small size`);
  }

  // uniform designs keep the product floor, or their fade layer does nothing
  const uni = buildField({
    ...B, modulation: 'uniform', minDia: 25, maxDia: 25,
    taper: 100, taperTarget: 'size', taperDriver: 'ramp',
    taperScope: 'wall', taperDir: '', taperAngle: 0,
  });
  const small = Math.min(...uni.holes.map((h) => 2 * h.r));
  assert.ok(small < 25, 'a uniform design must still fade');
  assert.ok(Math.abs(small - LIMITS.practicalFloor) < 1e-6, 'and toward the product floor');

  console.log('a fade panel ends on the stated small size and meets the plain field');
}

// -- the four chessboard corners --------------------------------------------
//
// Laid out as
//   [corner TL][fade up  ][corner TR]
//   [fade left][  board  ][fade right]
//   [corner BL][fade down][corner BR]
// each corner keeps the pattern at its inner corner and fades to the outer one,
// so its two inner edges must match the fade panels beside it and its two outer
// edges must be flat at the small size. All four are different panels - if any
// two ever come out identical the layout has collapsed.
{
  const base = {
    cols: 1, rows: 1, lattice: 'stagger', latticeAspect: 100, pitch: 50, shape: 'circle',
    minDia: 12.5, maxDia: 35, modulation: 'lattice', crossKx: 1, crossKy: 2, crossSharp: 0,
    wavelength: 420, modAngle: 45, modScope: 'run', gamma: 3, sizeContrast: 100,
    tiling: 'P1', cull: 0,
  };
  const fade = (angle, extra = {}) => ({
    ...base, taper: 100, taperTarget: 'size', taperDriver: 'ramp',
    taperScope: 'wall', taperDir: '', taperAngle: angle, ...extra,
  });
  const edge = (f, w) => {
    const xs = [...new Set(f.holes.map((h) => +h.cx.toFixed(3)))].sort((a, b) => a - b);
    const ys = [...new Set(f.holes.map((h) => +h.cy.toFixed(3)))].sort((a, b) => a - b);
    const pick = {
      top: (h) => Math.abs(h.cy - ys[0]) < 1e-6,
      bottom: (h) => Math.abs(h.cy - ys[ys.length - 1]) < 1e-6,
      left: (h) => Math.abs(h.cx - xs[0]) < 1e-6,
      right: (h) => Math.abs(h.cx - xs[xs.length - 1]) < 1e-6,
    }[w];
    const key = w === 'top' || w === 'bottom' ? 'cx' : 'cy';
    return f.holes.filter(pick).sort((a, b) => a[key] - b[key])
      .map((h) => h[key].toFixed(3) + '@' + (2 * h.r).toFixed(4)).join('|');
  };
  const F = {
    up: buildField(fade(270)), down: buildField(fade(90)),
    left: buildField(fade(180)), right: buildField(fade(0)),
  };
  const C = {
    TR: buildField(fade(315, { rampCorner: true })),
    TL: buildField(fade(225, { rampCorner: true })),
    BR: buildField(fade(45, { rampCorner: true })),
    BL: buildField(fade(135, { rampCorner: true })),
  };
  const JOINTS = {
    TR: [['left', 'up', 'right'], ['bottom', 'right', 'top'], ['top', 'right']],
    TL: [['right', 'up', 'left'], ['bottom', 'left', 'top'], ['top', 'left']],
    BR: [['left', 'down', 'right'], ['top', 'right', 'bottom'], ['bottom', 'right']],
    BL: [['right', 'down', 'left'], ['top', 'left', 'bottom'], ['bottom', 'left']],
  };
  for (const [k, [j1, j2, outers]] of Object.entries(JOINTS)) {
    assert.equal(edge(C[k], j1[0]), edge(F[j1[1]], j1[2]), `${k}: ${j1[0]} must meet fade ${j1[1]}`);
    assert.equal(edge(C[k], j2[0]), edge(F[j2[1]], j2[2]), `${k}: ${j2[0]} must meet fade ${j2[1]}`);
    for (const w of outers)
      for (const part of edge(C[k], w).split('|'))
        assert.ok(part.endsWith('@12.5000'), `${k}: outer ${w} edge must be the small size`);
  }
  const sig = (f) => f.holes.map((h) => h.cx.toFixed(2) + ',' + h.cy.toFixed(2) + ',' + (2 * h.r).toFixed(3)).join('|');
  const keys = Object.keys(C);
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++)
      assert.notEqual(sig(C[keys[i]]), sig(C[keys[j]]), `${keys[i]} and ${keys[j]} are the same panel`);

  console.log('four different chessboard corners, each meeting the two fades beside it');
}

// -- the fade curve paces the fade, it does not move the ends ---------------
//
// A straight fade takes the pattern apart from the first row: by mid panel the
// sizes have closed up and there is only a gradient left. The curve holds them
// apart and gives way at the joint. What it must never do is move an end - the
// inner edge is the untouched pattern and the outer edge is the small size, and
// both are what the neighbouring panels are cut to meet.
{
  const B = {
    cols: 1, rows: 1, lattice: 'stagger', latticeAspect: 100, pitch: 50, shape: 'circle',
    minDia: 12.5, maxDia: 35, modulation: 'checker', steps: 6, modScope: 'run',
    gamma: 1, sizeLevels: 1, sizeContrast: 0, cull: 0, tiling: 'P1',
  };
  const edge = (f, w) => {
    const xs = [...new Set(f.holes.map((h) => +h.cx.toFixed(3)))].sort((a, b) => a - b);
    const pick = w === 'left'
      ? (h) => Math.abs(h.cx - xs[0]) < 1e-6
      : (h) => Math.abs(h.cx - xs[xs.length - 1]) < 1e-6;
    return f.holes.filter(pick).sort((a, b) => a.cy - b.cy)
      .map((h) => h.cy.toFixed(3) + '@' + (2 * h.r).toFixed(4)).join('|');
  };
  const board = buildField(B);
  const plain = buildField({ ...B, modulation: 'uniform', maxDia: 12.5 });
  // 2 squares across and 4 down means the board tiles with itself both ways
  assert.equal(edge(board, 'left'), edge(board, 'right'), 'the board must tile left to right');

  let held = null;
  for (const g of [1, 1.6, 2.2, 3]) {
    const f = buildField({
      ...B, taper: 100, taperTarget: 'size', taperDriver: 'ramp',
      taperScope: 'wall', taperDir: '', taperAngle: 0, taperGamma: g,
    });
    assert.equal(edge(f, 'left'), edge(board, 'left'), `gamma ${g}: inner edge must be the board`);
    assert.equal(edge(f, 'right'), edge(plain, 'right'), `gamma ${g}: outer edge must be 12.5`);
    // and more of the pattern survives to mid-panel as the curve rises
    const mid = f.holes.filter((h) => Math.abs(h.cx - PANEL.moduleW / 2) < 26).map((h) => 2 * h.r);
    const spread = Math.max(...mid) - Math.min(...mid);
    if (held !== null) assert.ok(spread > held, `gamma ${g} must hold more pattern than the last`);
    held = spread;
  }
  console.log('the fade curve holds the pattern longer without moving either end');
}

// -- a border, so any panel meets any other ---------------------------------
//
// A fade is a gradient across a panel. This is the outermost ring of holes and
// nothing else: counted in rows, so that ring lands on EXACTLY the small hole
// size while the row just inside it is untouched pattern. That is what lets a
// patterned panel present a plain edge without softening the pattern to reach
// it - and it means any two panels carrying the border butt together.
{
  const B = {
    cols: 1, rows: 1, lattice: 'stagger', latticeAspect: 100, pitch: 50, shape: 'circle',
    minDia: 12.5, maxDia: 35, modulation: 'blocks', crossKx: 2, crossKy: 4, crossSharp: 100,
    gamma: 0.45, sizeContrast: 100, modScope: 'run', tiling: 'P4', driverScope: 'panel', cull: 0,
  };
  const bordered = {
    ...B, taper: 100, taperTarget: 'size', taperDriver: 'border',
    taperScope: 'wall', taperDir: '', taperRings: 1,
  };
  const edge = (f, w) => {
    const xs = [...new Set(f.holes.map((h) => +h.cx.toFixed(3)))].sort((a, b) => a - b);
    const ys = [...new Set(f.holes.map((h) => +h.cy.toFixed(3)))].sort((a, b) => a - b);
    const pick = {
      top: (h) => Math.abs(h.cy - ys[0]) < 1e-6,
      bottom: (h) => Math.abs(h.cy - ys[ys.length - 1]) < 1e-6,
      left: (h) => Math.abs(h.cx - xs[0]) < 1e-6,
      right: (h) => Math.abs(h.cx - xs[xs.length - 1]) < 1e-6,
    }[w];
    const k = w === 'top' || w === 'bottom' ? 'cx' : 'cy';
    return f.holes.filter(pick).sort((a, b) => a[k] - b[k])
      .map((h) => h[k].toFixed(3) + '@' + (2 * h.r).toFixed(4)).join('|');
  };
  const plain = buildField({ ...B, modulation: 'uniform', maxDia: 12.5 });
  const bare = buildField(B);
  const f = buildField(bordered);

  for (const w of ['left', 'right', 'top', 'bottom'])
    assert.equal(edge(f, w), edge(plain, w), `the ${w} ring must be exactly the small size`);

  // and the pattern inside is untouched - a border is not a fade
  const inner = (g) => g.holes
    .filter((h) => h.cx > 0.01 && h.cx < PANEL.moduleW - 0.01 && h.cy > 0.01 && h.cy < PANEL.moduleH - 0.01)
    .map((h) => h.cx.toFixed(2) + ',' + h.cy.toFixed(2) + ',' + (2 * h.r).toFixed(3))
    .sort().join('|');
  assert.equal(inner(f), inner(bare), 'a border must not touch the pattern inside it');

  // two rings reaches one row further in, and still lands on the boundary
  const two = buildField({ ...bordered, taperRings: 2 });
  assert.equal(edge(two, 'left'), edge(plain, 'left'), 'two rings still ends on the boundary');
  assert.notEqual(inner(two), inner(bare), 'and two rings does reach further in');

  console.log('a border ring lands on the small size without touching the pattern inside');
}

// -- whole blocks inside the panel, small holes on the boundaries -----------
//
// A plain cosine peaks at 0, so the blocks came out centred on the panel edges
// and corners and every one was cut in half by the boundary. Half a period
// across puts whole blocks inside instead - 2 across and 4 down at counts 2 and
// 4 - and drops the troughs onto the boundary lines, which is where the small
// holes have to be for the panels to meet.
{
  const B = {
    cols: 1, rows: 1, lattice: 'stagger', latticeAspect: 100, pitch: 50, shape: 'circle',
    minDia: 12.5, maxDia: 35, modulation: 'blocks', crossKx: 2, crossKy: 4, crossSharp: 100,
    gamma: 0.45, sizeContrast: 100, modScope: 'run', tiling: 'P4', driverScope: 'panel', cull: 0,
  };
  const blobs = (rec) => {
    const f = buildField(rec);
    const ds = f.holes.map((h) => 2 * h.r);
    const cut = (Math.min(...ds) + Math.max(...ds)) / 2;
    const N = 48;
    const M = 96;
    const g = [];
    for (let j = 0; j < M; j++) {
      const row = [];
      for (let i = 0; i < N; i++) {
        const x = ((i + 0.5) * PANEL.moduleW) / N;
        const y = ((j + 0.5) * PANEL.moduleH) / M;
        let b = null;
        let bd = 1e9;
        for (const h of f.holes) {
          const d = Math.hypot(h.cx - x, h.cy - y);
          if (d < bd) { bd = d; b = h; }
        }
        row.push(2 * b.r >= cut ? 1 : 0);
      }
      g.push(row);
    }
    const seen = g.map((r) => r.map(() => false));
    let n = 0;
    for (let j = 0; j < M; j++)
      for (let i = 0; i < N; i++) {
        if (!g[j][i] || seen[j][i]) continue;
        const st = [[i, j]];
        seen[j][i] = true;
        let sz = 0;
        while (st.length) {
          const [a, b2] = st.pop();
          sz++;
          for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const p = a + da;
            const q = b2 + db;
            if (p < 0 || q < 0 || p >= N || q >= M) continue;
            if (g[q][p] && !seen[q][p]) { seen[q][p] = true; st.push([p, q]); }
          }
        }
        if (sz >= 8) n++;
      }
    return n;
  };
  assert.equal(blobs({ ...B, crossPhase: 180 }), 8, 'phase 180 must put eight whole blocks in the panel');
  assert.ok(blobs({ ...B, crossPhase: 0 }) > 8, 'phase 0 cuts them on the edges, giving more pieces');

  // and every square boundary carries the small hole
  const f = buildField({ ...B, crossPhase: 180 });
  const onLine = (sel) => [...new Set(f.holes.filter(sel).map((h) => +(2 * h.r).toFixed(3)))];
  assert.deepEqual(onLine((h) => Math.abs(h.cx - 300) < 1e-6), [12.5], 'the centre line must be small holes');
  for (const y of [300, 600, 900])
    assert.deepEqual(onLine((h) => Math.abs(h.cy - y) < 1e-6), [12.5], `y=${y} must be small holes`);

  console.log('eight whole blocks in the panel, small holes on every square boundary');
}

// -- the transposed hex lattice --------------------------------------------
//
// 'hexV' is deliberately NOT offered in the picker: turning the LATTICE is not
// something this product wants - only the hole shape turns, which the angle
// control already does. It stays in the engine because six saved designs are
// built on it (Sashiko vertical / triangle / triangle 75 / 100, and both
// Asanoha), so this guards them. It is a TRANSPOSE, not a rotation: a rotated
// lattice cannot put a hole centre on both panel edges at once.
{
  const B = {
    cols: 2, rows: 2, shape: 'circle', minDia: 20, maxDia: 20,
    modulation: 'uniform', cull: 0, taper: 0, tiling: 'WALL', latticeAspect: 100,
  };
  for (const pitch of [40, 50, 60, 75]) {
    const a = buildField({ ...B, lattice: 'hex', pitch });
    const b = buildField({ ...B, lattice: 'hexV', pitch });
    // The turn is a transposed FAMILY, not the same numbers swapped: each
    // snaps its own spacing to divide the module, so at some pitches they
    // land on different values - at 75 the upright rows are 66.67 and the
    // turned columns 60.00. What makes it a 90 degree turn is the DIRECTIONS
    // the neighbours lie in: upright hex has a horizontal pair and no
    // vertical one, and the turned form is the other way round.
    const dirs = (f) => {
      const mid = f.holes.find((h) => h.cx > 200 && h.cx < 900 && h.cy > 300 && h.cy < 2000);
      return f.holes
        .map((h) => ({
          d: Math.hypot(h.cx - mid.cx, h.cy - mid.cy),
          a: Math.atan2(h.cy - mid.cy, h.cx - mid.cx),
        }))
        .filter((v) => v.d > 0.1)
        .sort((x, y) => x.d - y.d)
        .slice(0, 6)
        .map((v) => Math.round(Math.abs((v.a * 180) / Math.PI)));
    };
    const hasHoriz = (f) => dirs(f).some((d) => d === 0 || d === 180);
    const hasVert = (f) => dirs(f).some((d) => d === 90);
    assert.ok(hasHoriz(a), pitch + ": upright hex must have a horizontal neighbour pair");
    assert.ok(!hasVert(a), pitch + ": upright hex must NOT have a vertical pair");
    assert.ok(hasVert(b), pitch + ": the turned hex must have a vertical neighbour pair");
    assert.ok(!hasHoriz(b), pitch + ": the turned hex must NOT have a horizontal pair");
    // and both still meet both joints - that is what a transpose buys over a
    // rotation, which cannot land on two panel edges at once
    for (const f of [a, b]) {
      assert.ok(
        f.holes.some((h) => Math.abs(h.cx - PANEL.moduleW) < 1e-6),
        pitch + ": no hole on the vertical joint"
      );
      assert.ok(
        f.holes.some((h) => Math.abs(h.cy - PANEL.moduleH) < 1e-6),
        pitch + ": no hole on the horizontal joint"
      );
    }
  }
  console.log('the transposed hex lattice still meets both joints - Sashiko and Asanoha need it');
}

// -- rounding the small holes off toward circles ----------------------------
//
// The gradient carried by the change of SHAPE rather than only by size: the
// smallest holes are circles, the largest keep the full shape. Off by default,
// so nothing that existed before it moves.
{
  // FLATTENED BEFORE MEASURING. The outline carries its fillets as bulges -
  // two tangent points and an arc - so a check that reads the vertex list as a
  // polygon is reading the chords, not the shape. Everything geometric below
  // goes through flattenBulges first; what leaves for the DXF does not.
  const flat = (type, morph) => flattenBulges(shapeVerts(type, 0, 0, 10, { morph }));
  const round = (type, morph) => {
    const v = flat(type, morph);
    const p = [];
    for (let i = 0; i < v.length; i++) {
      const a = v[i];
      const b = v[(i + 1) % v.length];
      p.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
    const rs = p.map((q) => Math.hypot(q[0], q[1]));
    return Math.min(...rs) / Math.max(...rs);
  };
  for (const shape of ['hex', 'diamond', 'square']) {
    // fully rounded is a circle of the hole's own radius, to within the
    // faceting of the polyline it is cut as
    assert.ok(round(shape, 0) > 0.99, `${shape}: fully rounded must be a circle`);
    const v0 = flat(shape, 0);
    assert.ok(
      Math.abs(Math.max(...v0.map((q) => Math.hypot(q[0], q[1]))) - 10) < 1e-6,
      `${shape}: the circle must be the hole's own radius, not the inscribed one`
    );
    // and it gets rounder all the way, never doubling back
    let last = 0;
    for (const m of [1, 0.75, 0.5, 0.25, 0]) {
      const rr = round(shape, m);
      assert.ok(rr > last, `${shape}: rounding must be monotonic (${m})`);
      last = rr;
    }
    // IT MUST BE A FILLET, NOT A PULL TOWARD THE CIRCLE.
    //
    // Both round a shape off, and only one of them is what was asked for. Pull
    // the boundary in and every corner stays a corner - a shallower one, still
    // a point. Fillet it and the corner becomes an arc. The two are told apart
    // by the sharpest turn anywhere on the outline: a fillet leaves nothing
    // sharper than one segment of its own arc, a pull leaves the corner.
    for (const m of [0.75, 0.5, 0.25]) {
      const v = flat(shape, m);
      let sharp = 0;
      for (let i = 0; i < v.length; i++) {
        const a = v[i];
        const b = v[(i + 1) % v.length];
        const c = v[(i + 2) % v.length];
        const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
        assert.ok(len > 1e-9, `${shape}: repeated point`);
        let t = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
        while (t > Math.PI) t -= Math.PI * 2;
        while (t < -Math.PI) t += Math.PI * 2;
        t = Math.abs(t);
        sharp = Math.max(sharp, t);
      }
      if (shape === 'star') continue; // not convex; see morphVerts
      assert.ok(
        sharp < 0.35,
        `${shape}: morph ${m} still turns ${((sharp * 180) / Math.PI).toFixed(0)} degrees - that is a corner, not a fillet`
      );
      // AND THE FLATS ARE STILL FLAT - asked of the outline itself now that it
      // says so. A filleted convex polygon is one ARC per corner and one
      // STRAIGHT RUN per edge, and the vertex list carries exactly that: a
      // vertex with a bulge opens an arc, one without opens a line. Counting
      // them beats measuring segment lengths, which only worked while the arcs
      // were chopped into sixteen pieces each and stopped working the moment
      // they were not. (At morph 0 the straight runs correctly vanish - the
      // arcs have met - which is why 0 is not in this list.)
      const raw = shapeVerts(shape, 0, 0, 10, { morph: m });
      const corners = shapeVerts(shape, 0, 0, 10, { morph: 1 }).length;
      const arcs = raw.filter((q) => q.length > 2 && q[2]).length;
      assert.equal(arcs, corners, `${shape}: morph ${m} has ${arcs} arcs for ${corners} corners`);
      assert.equal(
        raw.length - arcs,
        corners,
        `${shape}: morph ${m} left ${raw.length - arcs} straight runs for ${corners} edges`
      );
    }

    // untouched at morph 1 - same vertex list as before the feature
    assert.deepEqual(
      shapeVerts(shape, 0, 0, 10, { morph: 1 }),
      shapeVerts(shape, 0, 0, 10),
      `${shape}: morph 1 must be the shape as drawn`
    );
  }

  const B = {
    cols: 1, rows: 1, lattice: 'hex', pitch: 50, shape: 'hex', minDia: 12, maxDia: 35,
    modulation: 'linear', modAngle: 90, modScope: 'run', gamma: 1, sizeLevels: 1,
    sizeContrast: 0, cull: 0, taper: 0, tiling: 'WALL',
  };
  const off = buildField({ ...B, shapeMorph: 0 });
  assert.ok(off.holes.every((h) => h.morph === undefined), 'off must not touch a hole');
  const on = buildField({ ...B, shapeMorph: 100 });
  const by = [...on.holes].sort((a, b) => a.r - b.r);
  // The smallest is not merely rounded to morph 0 - it IS a circle, and is
  // emitted as one. Rounded that far the flat left between two fillets is a
  // few hundredths of a millimetre, so circleSnapMm turns it into a CIRCLE
  // entity: one line of file instead of a dozen vertices and a dozen arcs
  // describing a circle the long way round.
  assert.equal(by[0].type, 'circle', 'the smallest hole must be cut as a circle');
  assert.equal(by[0].morph, undefined, 'a circle carries no fillet');
  {
    // and turning the snap off leaves it as the polygon it came from
    const raw = buildField({ ...B, shapeMorph: 100, circleSnapMm: 0 }).holes
      .slice()
      .sort((a, b) => a.r - b.r)[0];
    assert.equal(raw.type, 'hex', 'with the snap off the smallest stays a polygon');
    assert.ok(Math.abs(raw.morph) < 1e-6, 'and it is still fully rounded');
  }
  // The largest keeps the SHAPE, but not a true point: a tenth of the fillet
  // stays on it, because a field where every hole but one has had its corners
  // taken off makes that one read as a different shape rather than the end of
  // a range. Circularity says it is still a hexagon and not a circle.
  const big = by[by.length - 1];
  assert.ok(
    Math.abs(big.morph - 0.9) < 1e-6,
    `the largest must keep a light fillet, got morph ${big.morph}`
  );
  {
    // Measured as the CORNER RADIUS, not as circularity: a filleted polygon
    // carries its straight edges as two endpoints and nothing between, so the
    // nearest sampled point to the centre is a tangent point rather than an
    // edge midpoint, and min-over-max reads 0.99 for a shape that is plainly
    // still a hexagon. The radius of the circle through three consecutive
    // points is the tightest turn on the outline, which is the fillet itself.
    const v = flattenBulges(shapeVerts('hex', 0, 0, 10, { morph: big.morph }));
    let tightest = Infinity;
    for (let i = 0; i < v.length; i++) {
      const [x1, y1] = v[i];
      const [x2, y2] = v[(i + 1) % v.length];
      const [x3, y3] = v[(i + 2) % v.length];
      const A = Math.hypot(x2 - x1, y2 - y1);
      const Bs = Math.hypot(x3 - x2, y3 - y2);
      const C = Math.hypot(x3 - x1, y3 - y1);
      const sp = (A + Bs + C) / 2;
      const ar = Math.sqrt(Math.max(0, sp * (sp - A) * (sp - Bs) * (sp - C)));
      if (ar < 1e-9) continue;
      tightest = Math.min(tightest, (A * Bs * C) / (4 * ar));
    }
    assert.ok(tightest > 0.03 * 10, `the largest is barely filleted (${tightest.toFixed(2)} on r=10)`);
    assert.ok(tightest < 0.20 * 10, `the largest is rounding away (${tightest.toFixed(2)} on r=10)`);
  }
  // and turning it off puts a true point back
  {
    const sharp = buildField({ ...B, shapeMorph: 100, shapeMorphMax: 0 }).holes
      .slice()
      .sort((a, b) => a.r - b.r)
      .pop();
    assert.ok(Math.abs(sharp.morph - 1) < 1e-6, 'shapeMorphMax 0 must leave the shape as drawn');
  }
  // the area reported is the area of the rounded hole, not of the polygon
  const small = by[0];
  assert.ok(
    Math.abs(small.area - Math.PI * small.r * small.r) / (Math.PI * small.r * small.r) < 0.01,
    'a fully rounded hole must report a circle area'
  );

  console.log('small holes fillet off to circles, large ones keep the shape and its flats');

  // -- AND THE FILLET RIDES THE SIZE LADDER ---------------------------------
  //
  // It is cut from the finished radius, not from a field of its own, so the
  // size controls drive it: levels step it into the same few values, contrast
  // spreads it the same way. What that buys is the property this whole product
  // rests on - two holes of the same diameter are the same part, whatever
  // pattern or panel they sit in, so panels still meet along their edges.
  const ladder = (over) => {
    const m = new Map();
    for (const h of buildField({ ...B, minDia: 12.5, shapeMorph: 100, ...over }).holes) {
      const d = (h.r * 2).toFixed(2);
      // A hole snapped to a circle carries no morph, and 0 is what it means:
      // fully rounded is the bottom rung, not the top.
      const f = (h.type === 'circle' ? 0 : h.morph ?? 1).toFixed(3);
      assert.ok(!m.has(d) || m.get(d) === f, `${d}mm came out with two different fillets`);
      m.set(d, f);
    }
    return [...m.entries()].sort((a, b) => +a[0] - +b[0]);
  };
  for (const n of [2, 3, 4, 6]) {
    const L = ladder({ sizeLevels: n });
    assert.equal(L.length, n, `${n} size levels must give ${n} diameters`);
    // The rungs run from the small end to the large one - 0 to 0.9 with the
    // default light fillet on the largest, not 0 to 1.
    const TOP = 1 - 10 / 100;
    L.forEach(([, f], i) => {
      assert.ok(
        Math.abs(+f - (TOP * i) / (n - 1)) < 1e-3, // f is rounded to 3 places above
        `level ${i} of ${n}: fillet ${f} is off the ladder`
      );
    });
  }
  // the same diameter rounds by the same amount whatever produced it
  const ref = new Map(ladder({ sizeLevels: 4 }));
  for (const over of [
    { sizeLevels: 4, modulation: 'noise', noiseScale: 180, seed: 7 },
    { sizeLevels: 4, lattice: 'stagger' },
    { sizeLevels: 4, shape: 'square' },
    { sizeLevels: 4, gamma: 2.5 },
  ]) {
    for (const [d, f] of ladder(over)) {
      assert.equal(ref.get(d), f, `${d}mm rounds differently under ${JSON.stringify(over)}`);
    }
  }
  // both ends land exactly: the stated small size is a circle, the large one is not
  assert.equal(ref.get('12.50'), '0.000', 'the stated small size must be a full circle');
  assert.equal(ref.get('35.00'), '0.900', 'the stated large size must keep the shape, lightly filleted');
  console.log('the fillet rides the size ladder - one diameter, one part');

  // -- THE 50-35 FAMILY: ONE FIELD, THREE LEVELS, FOUR TRANSITIONS ---------
  //
  // One family, listed rather than named inline. A second was built on a
  // scattered rank instead of a cloud and then dropped; the shape of the checks
  // is kept, so bringing another back is one entry here and nothing else.
  // Whatever is in this list, each family must meet itself.
  const FAMILIES = ['50-35-Noise'];

  // Each family is built on its 30 %: a uniform lattice at pitch 50 with
  // a 35mm hexagon at every node, thinned by cloud removal to the open area in
  // the name. The other two levels are the SAME cloud at a different threshold,
  // which is the whole point - a panel of one has to meet a panel of another
  // along its edge, and that only works if both sides decide the holes standing
  // on the joint from the same field value.
  //
  // Three things are asserted, and each of them has failed at some point.
  {
    const DESIGNS = JSON.parse(readFileSync(new URL('./designs.json', import.meta.url), 'utf8'));
    const face = PANEL.faceW * PANEL.faceH;
    const qq = (v) => Math.round(v * 1e4) / 1e4;
    const joint = (f, i, side) => {
      const out = [];
      for (const { h, lx, ly } of panelHoles(f, f.panels[i])) {
        if (side === 'B' && Math.abs(ly) < 0.5) out.push(`${qq(lx)},${qq(h.r)}`);
        if (side === 'T' && Math.abs(ly - PANEL.moduleH) < 0.5) out.push(`${qq(lx)},${qq(h.r)}`);
        if (side === 'L' && Math.abs(lx) < 0.5) out.push(`${qq(ly)},${qq(h.r)}`);
        if (side === 'R' && Math.abs(lx - PANEL.moduleW) < 0.5) out.push(`${qq(ly)},${qq(h.r)}`);
      }
      return [...new Set(out)].sort().join('|');
    };

    // ONE: the name is the specification. Turning the perforation from a circle
    // into a hexagon once took 17 % off every one of these and nothing said a
    // word - the design called 10 % was delivering 8.2 %.
    for (const FAM of FAMILIES) {
    const rowOf = {};
    for (const [name, want] of [
      [`${FAM} 30%`, 30],
      [`${FAM} 20%`, 20],
      [`${FAM} 10%`, 10],
    ]) {
      const d = DESIGNS[name];
      assert.ok(d, `${name} is missing from designs.json`);
      const f = buildField({ ...d });
      const got = (f.stats.openArea / (d.cols * d.rows * face)) * 100;
      assert.ok(
        Math.abs(got - want) < 0.5,
        `${name} is ${got.toFixed(2)} % open, and its name says ${want} %`
      );

      // TWO: the P4 rule, strictly. All four tiles must decide the holes that
      // STAND ON a joint identically, or a panel cut as one tile cannot butt
      // against a panel cut as another. This is what tileBlendMm 0 broke: with
      // no band to reconcile them the four tiles each ran their own field right
      // up to the edge, and all four joints disagreed.
      // THE WHOLE FRINGE, NOT JUST THE JOINT LINE.
      //
      // What you see where two panels meet is a band. Reconciling the tiles on
      // the line alone left the first ring of holes different from tile to
      // tile - on the long edges, seven of eleven a single row in - so a run
      // read as a repeat of four visibly different edges. tileEdgeMm makes
      // every tile BE tile A inside that distance of any edge; past it they go
      // their own way, which is the point of P4.
      const band = d.tileEdgeMm ?? 0;
      assert.ok(band > 0, `${name}: no identical edge band`);
      const fringe = (i) =>
        panelHoles(f, f.panels[i])
          .filter(
            ({ lx, ly }) =>
              Math.min(lx, PANEL.moduleW - lx, ly, PANEL.moduleH - ly) <= band + 1e-6
          )
          .map(({ h, lx, ly }) => [lx, ly, h.r].map((v) => Math.round(v * 1e4)).join(','))
          .sort()
          .join('|');
      const fr = f.panels.map((_, i) => fringe(i));
      assert.ok(
        fr.every((x) => x === fr[0]),
        `${name}: the four tiles do not share the ${band}mm edge band`
      );
      for (const side of ['B', 'T', 'L', 'R']) {
        const rows = f.panels.map((_, i) => joint(f, i, side));
        assert.ok(
          rows.every((r) => r === rows[0]),
          `${name}: the four tiles disagree on the ${side} joint`
        );
      }
      const B = joint(f, 0, 'B');
      assert.equal(joint(f, 0, 'T'), B, `${name}: top and bottom joints differ`);
      assert.equal(joint(f, 0, 'R'), joint(f, 0, 'L'), `${name}: left and right joints differ`);
      rowOf[want] = B;
    }

    // THREE: a transition joins the two levels it is named for, hole for hole.
    //
    // It cannot be a tiling pattern to do it. Every driver here is wrapped on
    // the panel, which makes the top row a copy of the bottom row - harmless
    // for something that repeats, fatal for something whose entire job is to be
    // different at each end. Only 'ramp' is left unwrapped, and it counts
    // lattice rows, so it lands on exactly 0 at the bottom and exactly 1 at the
    // top and the thresholds there are exactly the two levels.
    for (const [name, bottom, top] of [
      [`${FAM} 10-20 transition`, 20, 10],
      [`${FAM} 10-30 transition`, 30, 10],
      [`${FAM} 20-30 transition`, 30, 20],
      [`${FAM} 10-solid transition`, 10, 0],
      [`${FAM} 20-solid transition`, 20, 0],
      [`${FAM} 30-solid transition`, 30, 0],
    ]) {
      const d = DESIGNS[name];
      assert.ok(d, `${name} is missing from designs.json`);
      assert.equal(d.modulation, 'ramp', `${name} must ride a ramp - anything else wraps`);
      // AND IT MUST USE THE WHOLE PANEL. cullBand squeezes the ramp into a
      // centred fraction of the driver, so at 50 a transition panel was a flat
      // quarter, a steep half and a flat quarter - a step you can see from
      // across the room. At 100 it changes on every row. The ends land either
      // way, because the ramp counts rows and reaches 0 and 1 at the last of
      // them whatever the band; the band only decides how abrupt the middle is.
      assert.equal(d.cullBand, 100, `${name}: the fade must run the whole panel`);

      const f = buildField({ ...d });
      // AND IT HAS TO READ AS A FADE, not just be one on paper.
      //
      // The threshold was always a straight line; what you saw was not. Open
      // area was measured row by row and fitted: the trend fell 0.5 points a
      // row while the row-to-row noise was 2.7, so rows visibly went back UP on
      // the way down, and the panel lost a third of its nominal span to the
      // scatter. Sharing the removal out along each row (cullEven) cut the
      // noise to 1.4 and returned the span - 19.0 points of the nominal 20 on
      // the 10-30 panel. Held here so it cannot quietly go back.
      const prof = (() => {
        const by = new Map();
        for (const h of f.holes) {
          const k = Math.round(h.cy);
          by.set(k, (by.get(k) || 0) + h.area);
        }
        const ys = [...by.keys()].sort((x, y) => x - y);
        const band = PANEL.moduleH / (ys.length - 1);
        const v = ys.map((y) => (by.get(y) / (d.cols * PANEL.moduleW * band)) * 100);
        const n = v.length;
        let sx = 0;
        let sy = 0;
        let sxx = 0;
        let sxy = 0;
        v.forEach((val, i) => {
          sx += i;
          sy += val;
          sxx += i * i;
          sxy += i * val;
        });
        const m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
        const c = (sy - m * sx) / n;
        return {
          dev: v.reduce((a, val, i) => a + Math.abs(val - (m * i + c)), 0) / n,
          span: Math.abs(m) * (n - 1),
        };
      })();
      // 2.2, not the 1.8 this started at. Holding the edge band identical
      // across the four tiles means the fringe rows cannot be evened - their
      // rank has to stay the shared one - and those rows are where the fade
      // begins and ends. It costs 1.44 to 1.95 on the worst panel, against the
      // 2.70 it was before any evening at all, and the requirement that a run
      // of panels meet cleanly outranks the last half point of smoothness.
      assert.ok(
        prof.dev < 2.2,
        `${name}: the fade wanders ${prof.dev.toFixed(2)} points off a straight line`
      );
      const nominal = top === 0 ? bottom : bottom - top;
      // Half, not 0.6: a panel that ends in solid has its profile bounded at
      // zero, so a straight-line fit through it necessarily understates the
      // slope. 10-solid measures 5.7 of its nominal 10 for that reason alone.
      assert.ok(
        prof.span > nominal * 0.5,
        `${name}: only ${prof.span.toFixed(1)} of its ${nominal} points of fade survive the scatter`
      );
      for (let i = 0; i < f.panels.length; i++) {
        assert.equal(
          joint(f, i, 'B'),
          rowOf[bottom],
          `${name} panel ${i}: the bottom does not meet the ${bottom} % pattern`
        );
        assert.equal(
          joint(f, i, 'T'),
          top === 0 ? '' : rowOf[top],
          `${name} panel ${i}: the top does not meet ${top === 0 ? 'solid' : top + ' %'}`
        );
      }
      // and it still tiles sideways, so a run of them is any length
      const L = f.panels.map((_, i) => joint(f, i, 'L'));
      assert.ok(L.every((r) => r === L[0]), `${name}: the tiles disagree on the left joint`);
      assert.equal(joint(f, 0, 'R'), L[0], `${name}: left and right joints differ`);
    }
    }
  }
  console.log('the 50-35 family: named open area, P4 joints, transitions that meet both levels');
  // -- A PANEL IS A PART. IT CANNOT DEPEND ON HOW MANY YOU RENDERED -------
  //
  // The cull threshold used to be ranked over the candidates of the whole
  // wall, and a wall holds no whole number of anything: a hole on a joint
  // belongs to one panel, and under P4 the four tiles turn up in whatever
  // proportion the run happens to have. So the rank of a field value moved
  // with the arrangement and so did the verdict. Every one of the 41 culled
  // designs delivered a different panel at 1x1 than at 3x3 - 50-35-Noise 35%
  // ran from 34.6 % to 36.4 % open, its joint row carrying 11 holes or 13.
  // Two designs cannot be made to meet along an edge while that is true.
  {
    const DESIGNS = JSON.parse(readFileSync(new URL('./designs.json', import.meta.url), 'utf8'));
    const partOf = (d, c, r) => {
      const f = buildField({ ...d, cols: c, rows: r });
      const pn = f.panels.find((x) => tileLabelFor(d.tiling, x.col, x.row) === 'A');
      return panelHoles(f, pn)
        .map(({ h, lx, ly }) => [lx, ly, h.r].map((v) => Math.round(v * 1e4)).join(','))
        .sort()
        .join('|');
    };
    for (const name of Object.keys(DESIGNS).filter((k) => k.startsWith('50-35-'))) {
      const d = DESIGNS[name];
      const ref = partOf(d, 1, 1);
      // 4x1 as well as 2x2: a P4R design needs four columns to show all four
      // of its tiles, and a P4 one needs two rows.
      for (const [c, r] of [
        [2, 2],
        [4, 1],
        [3, 3],
        [4, 2],
        [8, 1],
      ]) {
        assert.equal(partOf(d, c, r), ref, `${name}: tile A is a different part at ${c}x${r}`);
      }
    }
  }
  console.log('a 50-35 panel is the same part however many panels are on screen');

  // -- ONE CLOUD, OR THEY DO NOT MEET ---------------------------------------
  //
  // A level on its own removal seed cannot join anything: both sides of a joint
  // have to decide the holes standing on it from the same field value. So every
  // design in the family must carry the same cloud, and only the threshold may
  // differ. This is not hypothetical - five designs from before the family was
  // re-levelled came back into designs.json, on the seeds they had then. Their
  // open area was right, their names were right, and they would have joined
  // nothing, because the cloud underneath was a different cloud.
  {
    const DESIGNS = JSON.parse(readFileSync(new URL('./designs.json', import.meta.url), 'utf8'));
    const CLOUD = [
      'cullSeed',
      'cullShape',
      'cullScale',
      'cullAspect',
      'cullShear',
      'cullRough',
      'cullRandom',
      'cullOrder',
      'cullEven',
      'lattice',
      'pitch',
      'shape',
      'minDia',
      'maxDia',
      'tileBlendMm',
    ];
    for (const FAM of FAMILIES) {
      const fam = Object.keys(DESIGNS).filter((k) => k.startsWith(FAM));
      assert.equal(
        fam.length,
        9,
        `${FAM} is three levels and six transitions, found ${fam.length}: ${fam}`
      );
      // TILING IS NOT PART OF THE FIELD. What must match is that all four
      // tiles exist, since the removal threshold is ranked over the four seeds
      // together - P4 lays them in a 2x2 block, P4R in a line. A transition is
      // one panel tall, so a 2x2 only ever reaches two of them and a run reads
      // A B A B; P4R gives it all four across. Either way every tile falls back
      // to the shared field at its edges, so the two still meet.
      for (const n of fam)
        assert.ok(
          DESIGNS[n].tiling === 'P4' || DESIGNS[n].tiling === 'P4R',
          `${n} lays ${DESIGNS[n].tiling}, which is not four tiles`
        );
      const ref = DESIGNS[fam[0]];
      for (const n of fam)
        for (const f of CLOUD)
          assert.deepEqual(
            DESIGNS[n][f],
            ref[f],
            `${n} differs from ${fam[0]} on ${f} - it cannot meet the rest of its family`
          );
    }

    // and any design that puts a percentage in its name has to deliver it
    const face = PANEL.faceW * PANEL.faceH;
    for (const [n, d] of Object.entries(DESIGNS)) {
      const m = n.match(/(\d+(?:\.\d+)?)\s*%\s*$/);
      if (!m) continue;
      const f = buildField({ ...d });
      const got = (f.stats.openArea / (d.cols * d.rows * face)) * 100;
      assert.ok(
        Math.abs(got - Number(m[1])) < 0.5,
        `${n} delivers ${got.toFixed(2)} % open`
      );
    }
  }
  console.log('the family shares one field, and a name with a percentage delivers it');

  // -- ANY TILE MUST BUTT ANY TILE, IN EVERY P4 DESIGN THAT CLAIMS TO --------
  //
  // Not only in the 50-35 family. A P4 design lays four different panels; if
  // they disagree about the holes STANDING ON a joint, the two halves of a
  // shared hole are cut differently and the wall has a broken hole in it. Nine
  // designs did - Noise-Gradient 1235, the three Starlights, Rain, Rain B and
  // three Ref-Cumulas - all of them with tileBlendMm at 0, which makes
  // tileBlend return 1 and leaves each tile running its own field to the very
  // edge.
  //
  // Only designs that are meant to be four INTERCHANGEABLE panels are asked.
  // Two other things also call themselves P4 and are not broken:
  //   - a driver spanning the 2x2 unit (Noise, Wave, Checker, Torch, Vape,
  //     Linear, Water, ...) makes the four panels four quarters of one picture;
  //   - modScope 'run' stretches the driver over the whole wall on purpose.
  // Both are filtered out here rather than excused, because for them the
  // question does not arise.
  {
    const DESIGNS = JSON.parse(readFileSync(new URL('./designs.json', import.meta.url), 'utf8'));
    // Named, not silently skipped. Rain C and Rainfall Down survive the filter
    // but are not panel-periodic in fact - Rainfall Down is a wave at 41
    // degrees, which repeats on nothing the panel knows about.
    const KNOWN = new Set(['Rain C', 'Rainfall Down']);
    const qq = (v) => Math.round(v * 1e4) / 1e4;
    const broken = [];
    for (const [name, d] of Object.entries(DESIGNS)) {
      if (d.tiling !== 'P4' && d.tiling !== 'P4R') continue;
      if (d.modScope === 'run') continue;
      let per;
      try {
        per = driverPeriod(d);
      } catch {
        continue;
      }
      if (Math.round(per.w) !== PANEL.moduleW || Math.round(per.h) !== PANEL.moduleH) continue;
      const f = buildField({
        ...d,
        cols: d.tiling === 'P4R' ? 4 : 2,
        rows: d.tiling === 'P4R' ? 1 : 2,
      });
      const jn = (i, side) => {
        const out = [];
        for (const { h, lx, ly } of panelHoles(f, f.panels[i])) {
          if (side === 'B' && Math.abs(ly) < 0.5) out.push(`${qq(lx)},${qq(h.r)}`);
          if (side === 'T' && Math.abs(ly - PANEL.moduleH) < 0.5) out.push(`${qq(lx)},${qq(h.r)}`);
          if (side === 'L' && Math.abs(lx) < 0.5) out.push(`${qq(ly)},${qq(h.r)}`);
          if (side === 'R' && Math.abs(lx - PANEL.moduleW) < 0.5) out.push(`${qq(ly)},${qq(h.r)}`);
        }
        return [...new Set(out)].sort().join('|');
      };
      const ok = ['B', 'T', 'L', 'R'].every((side) =>
        f.panels.every((_, i) => jn(i, side) === jn(0, side))
      );
      if (!ok && !KNOWN.has(name)) broken.push(name);
    }
    assert.deepEqual(broken, [], `P4 designs whose tiles disagree on a joint: ${broken}`);
  }
  console.log('every interchangeable P4 design agrees with itself on all four joints');
  // -- STARLIGHT A, B AND C MUST MEET EACH OTHER --------------------------
  //
  // Three densities of one field, so a wall can step from open to nearly
  // solid. They cannot do it on nested joints: a sparse pattern only removes
  // holes the dense one also removes, so its joint holes are a SUBSET, and a
  // hole one panel cuts and its neighbour does not is left as half a hole.
  // cullEdge pins the joint line to a level all three share. They also have to
  // be on one cloud - they were on three different removal seeds, which no
  // amount of edge work can reconcile.
  {
    const DESIGNS = JSON.parse(readFileSync(new URL('./designs.json', import.meta.url), 'utf8'));
    const set = ['Starlight-A', 'Starlight-B', 'Starlight-C'];
    const qq = (v) => Math.round(v * 1e4) / 1e4;
    const edges = {};
    for (const n of set) {
      const d = DESIGNS[n];
      assert.ok(d, n + ' is missing');
      for (const f of ['cullSeed', 'cullShape', 'cullScale', 'cullEdge', 'pitch', 'lattice', 'shape', 'minDia', 'maxDia', 'seed'])
        assert.deepEqual(DESIGNS[n][f], DESIGNS[set[0]][f], n + ' differs from ' + set[0] + ' on ' + f);
      const fl = buildField({ ...d });
      edges[n] = ['B', 'T', 'L', 'R'].map((side) => {
        const out = [];
        for (const { h, lx, ly } of panelHoles(fl, fl.panels[0])) {
          if (side === 'B' && Math.abs(ly) < 0.5) out.push(qq(lx) + ',' + qq(h.r) + ',' + h.type);
          if (side === 'T' && Math.abs(ly - PANEL.moduleH) < 0.5) out.push(qq(lx) + ',' + qq(h.r) + ',' + h.type);
          if (side === 'L' && Math.abs(lx) < 0.5) out.push(qq(ly) + ',' + qq(h.r) + ',' + h.type);
          if (side === 'R' && Math.abs(lx - PANEL.moduleW) < 0.5) out.push(qq(ly) + ',' + qq(h.r) + ',' + h.type);
        }
        return [...new Set(out)].sort().join('|');
      });
    }
    for (const n of set)
      assert.deepEqual(edges[n], edges[set[0]], n + ' cannot butt ' + set[0]);
    // and the sizes they are specified at are the sizes they cut
    for (const n of set) {
      const st = buildField({ ...DESIGNS[n] }).stats;
      assert.ok(st.holeMinDia >= 12.4 && st.holeMinDia < 13.5, n + ': smallest is ' + st.holeMinDia);
      assert.ok(st.holeMaxDia > 39 && st.holeMaxDia <= 40.01, n + ': largest is ' + st.holeMaxDia);
    }
  }
  console.log('Starlight A, B and C butt one another on every edge');



}
