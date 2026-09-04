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
import { buildField, LIMITS, PANEL, quantileRank } from './pattern-core.js';
import { PRESETS } from './presets.js';
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

  // a plain diagonal is NOT a corner - if these ever matched, one of the two
  // is redundant and should go
  const diag = buildField({ ...B, modAngle: 45 });
  assert.notEqual(edge(diag, 'top'), edge(corner, 'top'));

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
