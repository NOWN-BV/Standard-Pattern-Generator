// prototypes/veil-standard-pattern/pattern-core.js
// VEIL Standard Pattern generator - pure geometry core. No React, no DOM.
//
// Contrast with src/client/pattern/generate.ts: that engine derives hole
// radii from a sampled raster (SPECTRAL, image-driven). This one is
// *parametric* - the Arktura-standard product line, where the pattern is a
// named recipe (lattice family + modulation) instead of an uploaded image.
// Same fabrication limits, same DXF contract, no image dependency.
//
// CONTINUITY (the "4 panels and getting continued" requirement)
// The lattice is generated in FIELD coordinates from integer indices
// anchored at the field origin (0,0) - never from the left edge of the
// visible run. Appending a 5th panel therefore extends the same lattice
// instead of re-flowing it: every hole that existed at cols=4 sits at the
// identical coordinate at cols=5. Panel seams are cut lines only.

// -- Authoritative constants (mirrors src/shared/constants/panels.ts) ------
export const PANEL = {
  faceW: 596, // INNER_W - perforated face
  faceH: 1196, // INNER_H
  moduleW: 600, // PANEL_W_EXPORT - module pitch used by the DXF contract
  moduleH: 1200, // PANEL_H_EXPORT
  installGap: 0, // no reveal - panels butt directly against each other
  exportGap: 100, // PANEL_GAP_EXPORT - nesting gap in the exported DXF
  perfInset: 2, // PERF_LOCAL_OFFSET
};

export const LIMITS = {
  // Mirrors spectRAL: laser on 1.5 mm aluminium, hole >= 1.0 x t, web >= 0.8 x t.
  minGap: 3, // RECOMMENDED_WEB (V4) - recommended land between holes
  webHardMin: 1.2, // WEB_HARD_MIN (V3) - absolute floor
  minDia: 1.5, // LASER_MIN_MM (V1) - below this a laser cannot cut at all
  practicalFloor: 12, // PRACTICAL_FLOOR_MM (V2) - below this reads as a pinhole
  maxDia: 75, // MAX_HOLE_MM (V5) - absolute pipeline ceiling
  maxPitch: 125, // coarsest lattice this product line allows
  minPerfArea: 63.6, // MIN_PERF_AREA - below this the hole is not cut
  bendClear: 15, // BEND_SNAP_CLEAR - retained for reference; no keep-out is applied
};

/** Largest hole this pitch can carry: min(75, pitch - 3). spectRAL d-max. */
export function maxDiaFor(pitch) {
  return Math.min(LIMITS.maxDia, pitch - LIMITS.minGap);
}

// HOW FAR A HOLE REACHES TOWARD ITS NEIGHBOUR, as a multiple of r.
//
// The size cap assumes r in every direction, which is true of a circle and
// false of a rhombus: turned 45 degrees on a square grid it reaches only
// r*cos45 toward the neighbour either side, so capping it like a circle throws
// away a factor of root 2 - enough that shapes which should nearly touch come
// out with a third of the module between them. Claimed ONLY where it is known
// for certain: a fixed angle on a plain grid, whose neighbours lie along x and
// y. Every other lattice puts neighbours in directions this does not check, so
// they keep 1 and the old conservative cap.
export function shapeReach(p) {
  if (p.shape !== 'rhomb' || p.lattice !== 'grid') return 1;
  if ((p.shapeAngleMode ?? 'fixed') !== 'fixed') return 1;
  const a = (Math.PI / 180) * (p.shapeAngleDeg ?? 0);
  const rm = p.ratioMax ?? 0;
  // The FATTEST proportion in the run is the one that has to fit.
  const q = Math.max(1, Math.min(Math.max(1, p.slotRatio ?? 1), rm > 0 ? rm : Infinity));
  const s = Math.abs(Math.sin(a));
  const c = Math.abs(Math.cos(a));
  // The MOST BOWED curve in the run is the one that has to fit.
  const cm = p.curveMax ?? 0;
  const k = Math.max(0.2, Math.max(p.shapeCurve ?? 1, cm > 0 ? cm : 0));
  // Support of a superellipse along d. Bowed out (k > 1) it reaches past the
  // straight edge, by ((a1)^m + (a2)^m)^(1/m) with m the dual exponent - at
  // k = 2 that is a circle, which on a square grid needs a hole root 2 smaller
  // than the rhombus does. Pinched in (k <= 1) the straight rhombus contains
  // it, so the max() below still bounds it and nothing is given away.
  const sup = (a1, a2) => {
    if (k <= 1) return Math.max(a1, a2);
    const m = k / (k - 1);
    return (a1 ** m + a2 ** m) ** (1 / m);
  };
  // Long axis (sin a, cos a), short axis its perpendicular, checked against
  // both neighbour directions and the worse of the two kept.
  return Math.max(sup(s, c / q), sup(c, s / q));
}

// WHAT SHAPE "DISTANCE FROM THE CENTRE" DRAWS.
//
// Straight-line distance draws a circle, and that is the only figure the
// radial driver could ever make. The Minkowski exponent generalises it at no
// cost: 1 sums the two axes instead of squaring them, whose contours are
// DIAMONDS, 2 is the circle it has always drawn, and large values approach a
// rectangle. Normalised on the corner so the far corner is still exactly 1
// whatever the exponent, which is what keeps the driver's range full.
export function minkowski(dx, dy, m) {
  const e = Math.max(0.5, Math.min(8, m ?? 2));
  if (Math.abs(e - 2) < 1e-9) return Math.hypot(dx, dy); // unchanged, exactly
  if (e >= 8) return Math.max(Math.abs(dx), Math.abs(dy));
  return (Math.abs(dx) ** e + Math.abs(dy) ** e) ** (1 / e);
}

// How far the shape reaches along ONE given direction, as a multiple of r.
// Shares its convention with the slot pair code: the long axis of a hole at
// angle a runs along (sin a, cos a) in field coordinates.
function shapeExtentFactor(p, dx, dy) {
  const a = rad(p.shapeAngleDeg ?? 0);
  const ax = Math.sin(a);
  const ay = Math.cos(a);
  const along = Math.abs(ax * dx + ay * dy);
  const across = Math.abs(ay * dx - ax * dy);
  const rm = p.ratioMax ?? 0;
  // The FATTEST proportion in the run is the one that has to fit.
  const q = Math.max(1, Math.min(Math.max(1, p.slotRatio ?? 1), rm > 0 ? rm : Infinity));
  if (p.shape === 'slot') {
    // A capsule: a segment of half-length r - w swept by a radius w = r/q.
    const w = 1 / q;
    return (1 - w) * along + w;
  }
  const cm = p.curveMax ?? 0;
  const k = Math.max(0.2, Math.max(p.shapeCurve ?? 1, cm > 0 ? cm : 0));
  if (k <= 1) return Math.max(along, across / q);
  const m = k / (k - 1);
  return (along ** m + (across / q) ** m) ** (1 / m);
}

// LARGEST RADIUS THE LATTICE CAN CARRY.
//
// nearestSpacing() has to collapse the lattice to a single number, because for
// a round hole that is all that matters. For a long thin one it is not: a
// horizontal dash is 47mm across its own row and 4mm between rows, and the two
// directions are limited by different spacings. Taking the smaller spacing and
// applying it to both caps that dash at 9mm - the pattern becomes impossible
// rather than tight. Where the neighbour directions are known exactly - a
// fixed-angle slot or rhombus on a plain grid, whose neighbours are at (px, 0)
// and (0, py) and nowhere else - each direction is solved on its own spacing.
// Everything else keeps the scalar rule, which is never optimistic.
export function maxRadiusFor(p) {
  const gated =
    (p.shape === 'slot' || p.shape === 'rhomb') &&
    p.lattice === 'grid' &&
    (p.shapeAngleMode ?? 'fixed') === 'fixed';
  if (!gated)
    return Math.min(LIMITS.maxDia, (nearestSpacing(p) - LIMITS.minGap) / shapeReach(p)) / 2;
  const { px, py } = latticeSpacing(p);
  let best = Infinity;
  for (const [dx, dy, dist] of [
    [1, 0, px],
    [0, 1, py],
  ]) {
    const f = shapeExtentFactor(p, dx, dy);
    // Two holes each reach f*r toward the other, so the metal left between
    // them is dist - 2*f*r, and that is what has to clear the minimum.
    if (f > 1e-9) best = Math.min(best, (dist - LIMITS.minGap) / (2 * f));
  }
  return Math.min(LIMITS.maxDia / 2, best);
}

export const LATTICES = ['grid', 'stagger', 'hex', 'hexV', 'brick', 'diagonal'];
export const WAVE_SHAPES = ['sine', 'triangle', 'sawtooth', 'square'];
export const MODULATIONS = [
  'image',
  'uniform',
  'linear',
  'zigzag',
  'radial',
  'wave',
  'lattice',
  'chevron',
  'blocks',
  'bands',
  'noise',
  'checker',
];
export const SHAPES = [
  'circle',
  'hex',
  'diamond',
  'rhomb',
  'square',
  'cross',
  'triangle',
  'star',
  'slot',
  'organic',
];

export const DEFAULTS = {
  cols: 4,
  rows: 2,
  gap: PANEL.installGap,
  lattice: 'stagger',
  // Pitch is DERIVED, never entered: pitch = moduleW / intervalCount with an
  // even count, so a module is a whole number of pitches and a hole centre
  // always lands on a panel joint. See resolvePitch().
  pitch: 100, // TARGET in mm - snapped by resolvePitch() to 600 / even n
  staggerFrac: 0.5,
  // ROW SPACING against column pitch, in percent. 100 is the family's own
  // proportion. Below 100 packs the rows closer, which is what turns a field
  // of dots into columns of dots - the lattice can be anisotropic without the
  // pitch itself changing, and pitch is what has to keep landing on the joint.
  latticeAspect: 100,
  latticeAngle: 0,
  shape: 'circle',
  minDia: 10,
  maxDia: 26,
  modulation: 'linear',
  // 'run'    - the ramp spans the visible run, so adding a panel restretches it.
  // 'locked' - the ramp is anchored in mm over `spanMm`, so adding a panel
  //            extends the pattern and every existing hole keeps its size.
  //            This is the mode to use for a run that grows on site.
  modScope: 'locked',
  spanMm: 2400,
  modAngle: 90, // 0 = left to right, 90 = top to bottom
  gamma: 1,
  // SIZE IN STEPS RATHER THAN A RAMP.
  //
  // Size otherwise follows the driver continuously, so a block of large holes
  // always fades out at its edge. Cutting the driver into levels first gives
  // the hole a hard boundary: two levels is a big hole or a small one and
  // nothing between, which is what a pattern of solid blocks needs. 1 is off.
  sizeLevels: 1,
  sizeSplit: 50, // with two levels, where the cut sits, as a percentage
  invert: false,
  wavelength: 900,
  waveShape: 'sine', // see waveform()
  // IMAGE DRIVER. The grid is carried IN the design, not as a path to a file:
  // a recipe that depends on a file somewhere is not a recipe, and the whole
  // point of designs.json is that a saved design reopens identically on another
  // machine. imageLum is base64 of one byte per sample, row-major.
  imageW: 0,
  imageH: 0,
  imageLum: '',
  imageFit: 'cover', // cover | contain | stretch
  imageInvert: false,
  // WHAT THE PICTURE IS LAID ACROSS.
  //
  // 'wall' spreads it once over the whole run - a photograph, and every panel a
  // unique part. 'unit' lays it across one repeat of the tiling instead, so the
  // picture becomes a tile: P1 gives one part, P4 gives four, and the run can
  // be any length. The picture has to be seamless at its own edges for that to
  // read continuously, which is a property of the grid, not of this setting.
  imageScope: 'wall', // 'wall' | 'unit' | 'block'
  // The repeat for 'block', in panels. P1 and P4 are only the 1x1 and 2x2
  // cases of this; a picture whose proportions are neither has to be allowed
  // its own block, or it can be tiled only by cropping it to fit - which is
  // what changes the picture rather than the framing.
  imageCols: 5,
  imageRows: 2,
  // SHAPE ORIENTATION. Not jitter: every rule below is a function of the
  // lattice index or of position, so the same node always gets the same angle
  // and the pattern still repeats on the module. That is what separates a
  // woven or radiating motif from the random rotation this engine removed.
  shapeAngleMode: 'fixed', // fixed | alt2 | tri | radial | tangential
  shapeAngleDeg: 0,
  slotRatio: 2.5, // slot length : width. 2.5 is the original capsule
  // PROPORTION DRIVEN INSTEAD OF SIZE.
  //
  // The driver otherwise only ever changes how BIG a hole is. Here it changes
  // its PROPORTION instead: the ratio runs from slotRatio at the low end of
  // the field to this at the high end. Hold size still (min dia = max dia)
  // and the whole gradient then lives in the shape - a rhombus that shears
  // from a square standing on its corner down to a sliver, with its long
  // diagonal never moving. 0 is off, and every hole keeps slotRatio.
  ratioMax: 0,
  // HOW THE SIDES BETWEEN THE TWO TIPS BEND.
  //
  // 1 is the straight rhombus. Below 1 the sides pinch inward and it becomes a
  // playing-card diamond; above 1 they bow out, reaching an ellipse at 2. The
  // two end points stay sharp at every value - only the sides move.
  shapeCurve: 1,
  // Driven the same way ratioMax drives the proportion: 0 leaves the curve
  // fixed, above 0 it runs from shapeCurve to this across the field.
  curveMax: 0,
  // The figure the radial driver draws: 1 diamond, 2 circle, high values a
  // rectangle. See minkowski().
  radialShape: 2,
  // STAMP. One lattice node can carry a GROUP of parallel holes rather than a
  // single one - which is the difference between a field of dashes and a woven
  // motif. The group is laid perpendicular to the hole's own angle, so it turns
  // with it, and the whole group shares the node's tile-space key so removal
  // takes it away as one motif instead of nibbling at it.
  stampCount: 3,
  stampGap: 12, // mm between the parallel holes, centre to centre
  // Chance each hole BEYOND the first is present, per node. 0 makes every
  // group full size; measuring the reference gave roughly two thirds singles,
  // a quarter pairs and a tenth triples, which is what 35 reproduces.
  stampVary: 0,
  // LINE PLACEMENT. Holes sit on the EDGES of the lattice, not on its nodes.
  //
  // This is what the reference actually is: the three line families of a
  // triangular grid, each line broken into dashes. Every dash lies on a grid
  // line - which is why lines drawn across the picture land on dash after dash
  // - but where each dash starts along its line is not fixed, so the field has
  // no translational period even though it is built on a perfectly regular
  // lattice. Placing holes at NODES, which is what every earlier attempt did,
  // can never produce that: nodes are where the lines cross, not where the
  // segments lie.
  // Clear distance kept at BOTH ends of every edge, in mm.
  //
  // This is the thing that stops one line intruding on another, and it does it
  // by construction rather than by arithmetic: if every dash keeps this much
  // back from the node its edge ends at, then two dashes meeting at that node
  // are held apart no matter how either of them slides. Three earlier attempts
  // tried to derive a safe slide instead and all three still overlapped - a
  // reserved gap needs no derivation, and the dash length is cut to fit it.
  // ASANOHA. See the placement for what these mean.
  asaDashFrac: 58, // dash length as a percentage of the small edge
  asaLayers: 3, // how many of the three coarse lattices are drawn
  asaKeep: 55, // chance an eligible edge is kept
  asaNoTriangle: true, // never let three dashes close a small triangle
  lineGap: 10,
  // Shift ONE family along its own lines, as a percentage of the dash length.
  // The three families otherwise sit at their edge midpoints, so their ends do
  // not line up; offsetting one of them brings the three sets of ends together
  // into triangle corners. It deliberately escapes the reserved gap, because
  // that is the point - so the clearance it costs is reported rather than
  // silently clamped away.
  lineShift: 0,
  // Stagger for the OTHER two families, as a percentage of the edge length.
  // The three families all sit at their edge midpoints by default, which lines
  // their ends up the same way everywhere. Moving the two diagonals along their
  // own lines lets them sit against the triangle centres instead of the edges,
  // so the two axes read differently - one on the triangle, one across it.
  lineStagger: 0,
  // A PARTNER DASH on some edges, taken straight off the reference rather than
  // reasoned out: same direction, offset 0.94 of a dash length at 23 degrees to
  // its own axis. That is what puts a same-direction neighbour closer than the
  // lattice period - a field with one dash per edge cannot, because its nearest
  // same-direction neighbour is always a full period away. Measured shells:
  // reference has one at 19.5px (99% same direction), this build had none.
  linePairChance: 0,
  linePairDist: 94, // % of the dash length
  linePairAngle: 23, // degrees off the dash axis
  lineFloat: 25, // how far a dash may slide along its own line, % of the edge
  lineSeed: 5,
  // Seed for the 'random3' angle rule.
  shapeAngleSeed: 3,
  motifMm: 200, // cell the radial / tangential rules point at
  // NOISE DRIVER SHAPE. The removal side has had these for a while through
  // cloudField(); the driver only ever had a scale and a seed, which is why a
  // noise-driven pattern had one look. Defaults reproduce the old field
  // exactly: rough 50 is gain 0.5, detail 2 is the two octaves it always used.
  noiseDetail: 2, // octaves
  noiseRough: 50, // fBm gain: how much each finer octave contributes
  noiseAspect: 100, // stretch, percent - 100 is round
  noiseShear: 0, // integer skew; whole steps keep it tileable
  steps: 5,
  jitter: 0, // always 0 - the pattern is always on grid
  tiling: 'P4', // P1 | P4 | WALL - see tileSample()
  // WHAT THE PATTERN DRIVER SPANS - see driverPeriod().
  //
  // 'panel' is how this has always worked: the driver is sampled on one 600 x
  // 1200 module whatever the tiling, so it repeats in every panel. Under P4
  // that means the driver contributes NOTHING to the difference between the
  // four tiles - with removal switched off, P4 renders exactly like P1.
  //
  // 'unit' samples it on one repeat of the tiling instead - still one panel
  // under P1, but the whole 1200 x 2400 block under P4 - so a wave, a ramp or a
  // crossed-wave lattice spans all four tiles and genuinely tells them apart.
  // The part count does not change: P4 is still four panels.
  driverScope: 'panel', // 'panel' | 'unit'
  seed: 7,
  // VANISH - holes removed entirely, at full size (the Vapor-cluster look).
  // 'cull' is the percentage removed; 'cullMode' decides whether that is even
  // across the field or follows the modulation driver so it fades out.
  cull: 0,
  cullMode: 'even', // 'even' | 'gradient'
  // Gradient mode ramps removal from cullFrom to cull across the driver.
  //
  // This is what lets one panel JOIN two densities. Ramping 0 -> N only ever
  // connects a solid field to one density; a transition panel between, say, 25%
  // and 79% removed needs both ends stated. Because a single cloud field is
  // being thresholded at a moving level, the survivors at the sparse end are a
  // strict SUBSET of those at the dense end - so holes only ever disappear as
  // you cross, never reappear. That nesting is what makes the join read as one
  // continuous dissolve, and it only holds while cullSeed / cullScale /
  // randomness stay fixed across the run.
  cullFrom: 0,
  // TAPER - a SECOND ramp, independent of the driver, that walks hole size
  // down across the run. The driver already owns hole size, so without this a
  // fade and a pattern are the same knob: you can have crossed waves OR a
  // left-to-right fade, never both. Amount is how far the far end drops, 100
  // meaning it reaches min dia. See taperRamp().
  // SIZE ALONG THE STREAK. Each unbroken run of holes down a column is one
  // unit, and the size runs from one end of it to the other - so the gradient
  // belongs to the streak rather than to the wall. runFlip turns some of them
  // end for end so the units do not all grow the same way.
  runSize: false,
  runFlip: 50,
  // Thinning by WHOLE streaks. Removing holes one at a time breaks the streaks
  // into stubs - the one thing that cannot happen if the streak is the unit -
  // so the streaks are dropped entire, which thins the field sideways and
  // leaves the survivors their full length.
  runKeep: 100,
  runMin: 1,
  // Thinning by COLUMN rather than by streak. Dropping streaks independently
  // scatters them and breaks up the diagonal they are meant to lie along;
  // keeping one column in every N leaves the diagonal intact and simply spaces
  // it out, which is how the reference reads.
  runEvery: 1,
  // THE THICK END FOLLOWS A SAWTOOTH.
  //
  // Sizing each streak from one of its own ends puts the big holes wherever the
  // streak happens to start, which reads as noise. Instead a sawtooth line runs
  // across the field, and every streak puts its largest hole where that line
  // crosses it - so the thick points climb, drop back, and climb again on a
  // fixed beat.
  runPeak: false,
  peakPeriod: 1200, // how far across before the line drops back, in mm
  peakRise: 900, // how far it climbs over one period, in mm
  peakFall: 4, // dots from the largest hole down to the smallest
  zigHeight: 600, // how tall one rise-and-fall of the band is, in mm
  zigAmp: 150, // how far the band wanders sideways, in mm
  kitCols: 4, // with driverScope 'kit': how many panels the field repeats over
  kitRows: 2,
  taper: 0, // strength; 0 turns the whole layer off
  taperDriver: 'linear', // linear | band | radial | wave | noise | lattice | chevron | blocks | random | even
  // Cycle counts and sharpness for the crossed-wave fade shapes. Deliberately
  // separate from crossKx / crossKy / crossSharp: the whole point of the layer
  // is that it does its own thing while the pattern driver does its own.
  taperKx: 2,
  taperKy: 4,
  taperSharp: 100,
  // Measured across ONE PANEL TILE by default, so the fade repeats with the
  // tiling and a faded run stays a repeating kit. 'wall' measures across the
  // whole run instead: one single sweep, and every panel a unique part.
  taperScope: 'tile', // 'tile' | 'wall'
  taperDir: 'right', // right | down-right | down | down-left | left | up-left | up | up-right
  taperAngle: 0, // legacy free angle; taperDir wins when set
  taperWavelength: 900,
  taperSeed: 11,
  taperInvert: false, // swap which end of the layer is faded
  taperTarget: 'size', // 'size' | 'removal' | 'both'
  // Fraction of the driver the change is spread over, centred. 100 = the old
  // straight ramp from one edge to the other. Lower values hold cullFrom for a
  // while, change across a band in the middle, then hold cull - which is what a
  // transition PANEL usually wants: its bottom has to read as the neighbour
  // below it and its top as the neighbour above, or the joins look like the
  // gradient starts mid-panel.
  cullBand: 100,
  // WHAT THE GRADIENT RAMPS ALONG.
  //
  // 'pattern' is the original: removal follows the pattern driver, so on a
  // patterned design the ramp is stuck with whatever shape the pattern has -
  // a crossed-wave lattice cannot also dissolve left to right, because the
  // driver is already spoken for. 'fade' ramps along the fade layer's field
  // instead, which has its own shape, direction, scale and seed. The layer's
  // AMOUNT is deliberately not applied here: depth of the ramp is already set
  // by 'removed at start' and 'holes removed'.
  cullDriver: 'pattern', // 'pattern' | 'fade'
  cullOrder: 'blue', // legacy: 'white' is equivalent to cullRandom 100
  // Removal has its OWN seed. The modulation seed is only exposed for the
  // drivers that use it, so sharing it left the dissolve unchangeable on a
  // uniform or linear field.
  cullSeed: 7,
  // Width in mm over which a tile blends back to the shared edge field.
  // Smaller = tiles differ more; larger = safer, more similar tiles.
  tileBlendMm: 150,
  // Presentation only - carried in the recipe so a saved design reopens looking
  // the same, and used by the SVG export. Never affects geometry.
  holeColor: '#ffffff',
  panelColor: '#8b8f94',
  // Spreads the size field across the full min..max range. A noise driver is
  // bell-shaped, so left alone it only ever uses the middle of the range and
  // the field reads as soft mottling instead of small-beside-large.
  sizeContrast: 0,
  // 'scatter' decides each hole independently (even or random, but never
  // clustered). 'clouds' drives removal from a smooth noise field, so nearby
  // holes share a fate and the voids form organic blobs.
  // 'lattice' pins every hole to a 600/n grid - centres land on joints and
  // the pitch controls apply. 'packed' drops the grid entirely and packs
  // circles of varying size against each other, which is the only way to get
  // an interstitial, foam-like field. Pitch is meaningless when packed.
  placement: 'lattice', // 'lattice' | 'packed'
  packDensity: 70, // packed only: how hard to push circles together, 0-100
  packVariation: 60, // packed only: spread of sizes, 0 = all one size
  cullShape: 'scatter', // 'scatter' | 'clouds'
  cullScale: 400, // clouds only: blob size in mm
  // Cluster SHAPE. 100 = round; below stretches them wide, above stretches
  // them tall. Expressed as a percentage so 100 is the neutral middle.
  cullAspect: 100,
  // Diagonal lean, in whole steps. Only whole numbers are offered because a
  // shear of a whole period maps the tile onto itself and stays seamless,
  // whereas a free rotation of a tileable field does not - see cloudField().
  cullShear: 0,
  // Edge roughness: how much fine detail rides on top of the big blobs.
  cullRough: 50,
  // 'lattice' / 'chevron' only: how sharply the two wave families combine.
  // 0 blends them (soft, cloudy crossings); 100 takes the stronger of the two
  // (crisp bands with bright intersections, the argyle read).
  crossSharp: 100,
  blockAngle: 0, // turn the blocks driver, in degrees
  // NOISE READ IN SQUARES.
  //
  // The blocks driver is regular by construction - a grid of identical cells -
  // so it cannot give blocks that differ in size and position. Reading the
  // noise at a snapped point does: the field is then constant across each
  // square of the snap grid, which turns smooth cloud into flat-topped blocks
  // with hard edges, irregular because the noise underneath is. 0 is off, and
  // blockAngle turns the snap grid so the blocks can sit square to a rotated
  // dot screen.
  noiseSnap: 0,
  noiseSnapAspect: 100, // snap cell shape: 100 square, higher makes it taller
  // WAVE COUNTS, not a wavelength.
  //
  // A diagonal wave only meets itself across a joint if it completes a WHOLE
  // number of cycles over the module. Given a free angle + wavelength almost
  // nothing satisfies that: at 45 degrees the projected period is
  // 600*cos45 = 424.264mm, so only 424.264, 212.132, 141.421 ... work, and
  // everything between them visibly breaks at every panel edge.
  //
  // Counting cycles across the module instead makes every setting seamless by
  // construction - the same reason pitch is derived from an even interval count
  // rather than typed in. Angle and wavelength become readouts.
  crossKx: 2, // cycles across the 600mm width
  crossKy: 4, // cycles up the 1200mm height
  // 0 = perfectly even (blue noise), 100 = fully random (white noise).
  // Intermediate values blend, so the dissolve can be loosened by degrees
  // rather than flipped between two extremes.
  cullRandom: 0,
  cullFade: 0, // width of the shrink band around the void, % of the cull threshold
  centerX: 0.5, // radial centre, normalised to the field
  centerY: 0.5,
  // 'allow': a hole centred on a joint or a panel edge is emitted at full
  // size and straddles it. 'drop'/'shrink' keep holes wholly inside one panel,
  // which blanks the joint column and breaks continuity across the seam.
  seamRule: 'allow', // 'drop' | 'shrink' | 'allow'
  edgeInset: 0, // no keep-out - the pattern runs to the panel edge
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const rad = (deg) => (deg * Math.PI) / 180;

/** Deterministic hash to [0,1). Same seed + same indices = same field. */
function hash2(ix, iy, seed) {
  let h =
    Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 2654435761);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Seeded value noise, smoothed over a `cell`-mm grid. */
function valueNoise(x, y, cell, seed) {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = smooth(x / cell - gx);
  const fy = smooth(y / cell - gy);
  const a = lerp(hash2(gx, gy, seed), hash2(gx + 1, gy, seed), fx);
  const b = lerp(hash2(gx, gy + 1, seed), hash2(gx + 1, gy + 1, seed), fx);
  return lerp(a, b, fy);
}

// What fraction of its 2r x 2w box a curved rhombus fills. Measured by
// shoelace on THE SAME 32 points the shape is cut from, not from the closed
// form for the smooth curve - so the reported open area is the area of the
// actual part. Memoised per exponent; it depends on nothing else.
const superFillCache = new Map();
function superFill(k) {
  const kk = Math.max(0.2, k ?? 1);
  if (Math.abs(kk - 1) < 1e-9) return 0.5; // the straight rhombus, exactly
  const hit = superFillCache.get(kk);
  if (hit !== undefined) return hit;
  const e = 2 / kk;
  const N = 32;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const th = (i * 2 * Math.PI) / N;
    const ct = Math.cos(th);
    const st = Math.sin(th);
    pts.push([Math.sign(ct) * Math.abs(ct) ** e, Math.sign(st) * Math.abs(st) ** e]);
  }
  let s2 = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % N];
    s2 += a[0] * b[1] - b[0] * a[1];
  }
  const val = Math.abs(s2) / 2 / 4; // the unit box is 2 x 2
  superFillCache.set(kk, val);
  return val;
}

/** Face-area of one hole. Ported from src/client/pattern/shapes.ts holeArea(). */
export function holeArea(shape, r, ratio, curve) {
  switch (shape) {
    case 'circle':
      return Math.PI * r * r;
    case 'hex':
      return 2.598 * r * r;
    case 'diamond':
      return 2 * r * r * 0.7;
    case 'rhomb':
      // Box 2r by 2r/ratio; how much of it the shape fills depends on how the
      // sides bend. At the straight default superFill is exactly 1/2, which is
      // the half-of-the-box a rhombus fills.
      return 4 * r * (r / Math.max(1, ratio ?? 1)) * superFill(curve);
    case 'square':
      return r * 0.8 * (r * 0.8) * 4;
    case 'cross':
      return 2 * r * (2 * r) * 0.13;
    case 'triangle':
      return 0.433 * (2 * r) * (2 * r) * 0.25;
    case 'star':
      return Math.PI * r * r * 0.5;
    case 'slot': {
      // Capsule: a rectangle plus the two end caps. The old constant said
      // 0.5 r^2 for every slot whatever its proportions - about a third of the
      // truth at the default 2.5:1, which let slots through the minimum-area
      // rule that should never have been cut.
      const w = (2 * r) / Math.max(1.05, ratio ?? 2.5);
      return (2 * r - w) * w + Math.PI * (w / 2) * (w / 2);
    }
    case 'organic':
      return Math.PI * r * r * 0.85;
    default:
      return Math.PI * r * r;
  }
}

/** Field extents for a cols x rows run of modules separated by `gap`. */
export function fieldSize(p) {
  return {
    fieldW: p.cols * PANEL.moduleW + (p.cols - 1) * p.gap,
    fieldH: p.rows * PANEL.moduleH + (p.rows - 1) * p.gap,
  };
}

/** Perforated face rect of one panel, in field coords (y down). */
export function panelFaceRect(col, row, p) {
  // FULL MODULE, not the 596 x 1196 face. The perforated area runs to the
  // module edge so the pattern continues across a joint: a hole centred at
  // x = 600 is shared by both panels instead of landing in a 4 mm inset band
  // where buildField's owner test finds no panel and silently drops it.
  const insetX = 0;
  const insetY = 0;
  return {
    x: col * (PANEL.moduleW + p.gap) + insetX,
    y: row * (PANEL.moduleH + p.gap) + insetY,
    w: PANEL.moduleW,
    h: PANEL.moduleH,
  };
}

/**
 * Pitch derived from the interval count: moduleW / n, with n an even
 * integer >= 2. Never entered directly.
 *
 * This is what puts a hole centre on every panel joint. A module is exactly
 * n pitches wide and 2n tall, so x = 600, 1200, ... are always lattice
 * points. A free pitch (the old default of 34 mm) divides 600 into 17.6
 * intervals, so the joint falls between hole columns and every seam shows a
 * blank band.
 */
export function resolvePitch(p) {
  // Port of spectRAL effectivePitch(). The user enters a TARGET pitch in mm;
  // it is snapped to the nearest value the lattice can actually realise,
  // moduleW / n with n an even integer >= 2. A target between two achievable
  // values realises the same lattice as its neighbour, so the raw number is
  // misleading on its own - the snapped value is what gets reported.
  const target = Number.isFinite(p.pitch) && p.pitch > 0 ? p.pitch : 60;
  let n = Math.round(PANEL.moduleW / target);
  if (n % 2 !== 0) n -= 1; // even intervals -> odd hole count -> true centre
  // Pitch is capped at LIMITS.maxPitch, which sets the FLOOR on the interval
  // count: 600 / 75 = 8, so anything coarser than 8 intervals is out of range.
  // Kept as a derived floor rather than a magic 8 so the two stay in step.
  const nMin = Math.ceil(PANEL.moduleW / LIMITS.maxPitch / 2) * 2;
  n = Math.max(nMin, n);
  const pitch = PANEL.moduleW / n;
  // PITCH IS PRIMARY. It snaps to the nearest achievable lattice and stops
  // there - it is never pushed up to accommodate a large max dia. spectRAL
  // resolves that conflict the other way round: the hole is clamped to
  // maxDiaFor(pitch) = min(75, pitch - 3). Letting diameter drive pitch made
  // a typed 52 mm jump to 100 mm, which reads as the control being ignored.
  return { n, pitch, target };
}

/**
 * Tile transform: where the pattern is SAMPLED for a point, before modulation.
 * Geometry is still emitted at the true position.
 *
 *   WALL - identity. One design across the whole wall.
 *   P4   - reflect at each module edge, both axes. A 2 x 2 block A B / C D that
 *          repeats; reflection maps a joint onto itself, so both panels agree
 *          there and the field stays continuous.
 *   P1   - wrap at each module edge. One panel repeated; a gradient restarts at
 *          every joint, which is inherent to repeating a single SKU.
 */
export function tileSample(tiling, x, y) {
  if (tiling === 'WALL') return { x, y };
  const fold = (v, period) => {
    const span = period * 2;
    let u = v % span;
    if (u < 0) u += span;
    return u <= period ? u : span - u;
  };
  const wrap = (v, period) => {
    let u = v % period;
    if (u < 0) u += period;
    // SNAP THE SEAM. A joint at x = 600k can land on ~0 or on ~599.999999
    // depending on which way the float error falls, so the identical logical
    // point gets two different sample coordinates - and therefore two different
    // ranks, two different cull verdicts, and panels that are almost but not
    // quite the same. Collapsing anything within a micron of either end onto 0
    // makes the tile lookup a true function of position.
    const EPS = 1e-6;
    if (u < EPS || period - u < EPS) u = 0;
    return u;
  };
  // WRAP, never fold.
  //
  // Folding mirrored every other panel, which guaranteed matching edges but
  // made B a visible reflection of A. Wrapping replays the identical tile
  // instead, so all four panels are the same part - and their boundaries match
  // exactly rather than approximately, because a boundary hole samples the
  // same point from either side.
  void fold;
  return { x: wrap(x, PANEL.moduleW), y: wrap(y, PANEL.moduleH) };
}

/**
 * Blue-noise rank over a candidate set, ported from spectRAL rank.ts.
 *
 * Farthest-point ordering: each successive pick is the point furthest from
 * everything chosen so far. Any PREFIX of that order is spatially well spread,
 * so removing the first k% never clumps - which is what makes a culled field
 * read as an even dissolve rather than as blotches. White noise is a plain
 * hash: cheap, but it clusters visibly.
 *
 * O(N^2), so above CULL_BLUE_MAX it degrades to white and says so.
 */
export const CULL_BLUE_MAX = 4000;

export function rankPoints(pts, seed, order) {
  const N = pts.length;
  const rank = new Float64Array(N);
  if (N === 0) return { rank, fellBack: false };
  if (order !== 'blue' || N > CULL_BLUE_MAX) {
    for (let i = 0; i < N; i++) rank[i] = hash2(Math.round(pts[i].x), Math.round(pts[i].y), seed);
    return { rank, fellBack: order === 'blue' && N > CULL_BLUE_MAX };
  }
  // Seed the walk deterministically, then walk farthest-point.
  let first = 0;
  let best = Infinity;
  for (let i = 0; i < N; i++) {
    const hv = hash2(Math.round(pts[i].x), Math.round(pts[i].y), seed);
    if (hv < best) { best = hv; first = i; }
  }
  const chosen = new Uint8Array(N);
  const dist = new Float64Array(N);
  let cur = first;
  chosen[first] = 1;
  rank[first] = 0;
  for (let i = 0; i < N; i++) {
    const dx = pts[i].x - pts[cur].x;
    const dy = pts[i].y - pts[cur].y;
    dist[i] = dx * dx + dy * dy;
  }
  for (let picked = 1; picked < N; picked++) {
    let bi = -1;
    let bd = -1;
    for (let i = 0; i < N; i++) {
      if (chosen[i]) continue;
      if (dist[i] > bd) { bd = dist[i]; bi = i; }
    }
    if (bi < 0) break;
    chosen[bi] = 1;
    rank[bi] = picked / N;
    cur = bi;
    for (let i = 0; i < N; i++) {
      if (chosen[i]) continue;
      const dx = pts[i].x - pts[cur].x;
      const dy = pts[i].y - pts[cur].y;
      const d = dx * dx + dy * dy;
      if (d < dist[i]) dist[i] = d;
    }
  }
  return { rank, fellBack: false };
}

/**
 * Value noise that WRAPS over a period, so the field is seamless.
 *
 * Ordinary value noise hashes absolute cell indices, so the value at x = 0 and
 * at x = 600 are unrelated and a panel's two edges never match. Here the cell
 * index is taken modulo the number of cells in one period, so the grid closes
 * on itself: noise(0) === noise(period) exactly, and every panel edge carries
 * the same profile.
 *
 * The cell size is snapped to an exact division of the period - a period that
 * is not a whole number of cells cannot wrap, and would reintroduce the very
 * seam this exists to remove.
 */
export function tileableValueNoise(x, y, cell, seed, periodX, periodY) {
  const cellsX = Math.max(1, Math.round(periodX / cell));
  const cellsY = Math.max(1, Math.round(periodY / cell));
  const cx = periodX / cellsX;
  const cy = periodY / cellsY;
  const wrap = (i, n) => ((i % n) + n) % n;
  const gx = Math.floor(x / cx);
  const gy = Math.floor(y / cy);
  const fx = smooth(x / cx - gx);
  const fy = smooth(y / cy - gy);
  const h = (ix, iy) => hash2(wrap(ix, cellsX), wrap(iy, cellsY), seed);
  const a = lerp(h(gx, gy), h(gx + 1, gy), fx);
  const b = lerp(h(gx, gy + 1), h(gx + 1, gy + 1), fx);
  return lerp(a, b, fy);
}

/** Seamless fBm - every octave wraps on the same period. */
/**
 * Tileable value noise with INDEPENDENT cell sizes per axis.
 *
 * Each axis rounds its own cell count to a whole number of cells per period, so
 * the field still wraps exactly - which is what makes an elongated cluster
 * field as seamless as a round one. A single shared cell size can only ever
 * produce isotropic blobs.
 */
export function tileableValueNoiseAniso(x, y, cellX, cellY, seed, periodX, periodY) {
  const cellsX = Math.max(1, Math.round(periodX / Math.max(1, cellX)));
  const cellsY = Math.max(1, Math.round(periodY / Math.max(1, cellY)));
  const cx = periodX / cellsX;
  const cy = periodY / cellsY;
  const wrap = (i, n) => ((i % n) + n) % n;
  const gx = Math.floor(x / cx);
  const gy = Math.floor(y / cy);
  const fx = smooth(x / cx - gx);
  const fy = smooth(y / cy - gy);
  const h = (ix, iy) => hash2(wrap(ix, cellsX), wrap(iy, cellsY), seed);
  const a = lerp(h(gx, gy), h(gx + 1, gy), fx);
  const b = lerp(h(gx, gy + 1), h(gx + 1, gy + 1), fx);
  return lerp(a, b, fy);
}

/**
 * The cluster field, with shape control. Seamless on the module.
 *
 *   size    - cell size in mm, i.e. how big a blob is
 *   aspect  - stretches the cells: <100 wide and flat, >100 tall and narrow
 *   shear   - leans the field diagonally, in WHOLE steps
 *   rough   - amplitude of the finer octaves, so 0 is smooth-edged blobs and
 *             100 is ragged, broken-up ones
 *
 * WHY SHEAR IS INTEGER-ONLY. Rotating a tileable field by an arbitrary angle
 * destroys its periodicity: the wrapped lattice no longer lands on itself, so
 * the panel edges stop matching. A shear of a WHOLE period does land on itself
 * (moving one period in y shifts x by an exact number of periods), so diagonal
 * character is available without giving up seamlessness. Free rotation is not,
 * and pretending otherwise would silently break the tiling.
 */
export function cloudField(x, y, opts) {
  const { size, aspect, shear, rough, seed, periodX, periodY, octaves } = opts;
  const asp = Math.max(0.05, (aspect ?? 100) / 100);
  // Elongate by splitting the cell size across the axes. sqrt keeps the blob
  // AREA roughly constant as it is stretched, so changing shape does not also
  // change apparent density.
  const cellX = size / Math.sqrt(asp);
  const cellY = size * Math.sqrt(asp);
  const k = Math.round(shear ?? 0);
  const sx = k === 0 ? x : x + (k * periodX * y) / periodY;

  const gain = 0.25 + 0.5 * Math.min(1, Math.max(0, (rough ?? 50) / 100));
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let cx = cellX;
  let cy = cellY;
  for (let o = 0; o < Math.max(1, octaves); o++) {
    sum += amp * tileableValueNoiseAniso(sx, y, cx, cy, seed + o * 101, periodX, periodY);
    norm += amp;
    amp *= gain;
    cx *= 0.5;
    cy *= 0.5;
  }
  return sum / norm;
}

export function tileableFbm(x, y, cell, seed, periodX, periodY, octaves = 3) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let c = Math.max(1, cell);
  for (let o = 0; o < octaves; o++) {
    sum += amp * tileableValueNoise(x, y, c, seed + o * 101, periodX, periodY);
    norm += amp;
    amp *= 0.5;
    c *= 0.5;
  }
  return sum / norm;
}

/**
 * Fractal value noise - a few octaves of valueNoise at halving scales.
 *
 * One octave gives soft, featureless blobs; stacking a couple adds the ragged
 * edges and small satellite holes that make a cluster field read as organic
 * rather than as a blurred mask.
 */
export function fbm(x, y, cell, seed, octaves = 3) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let c = Math.max(1, cell);
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, c, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    c *= 0.5;
  }
  return sum / norm;
}

/**
 * Replace values by their QUANTILE within the set, giving a uniform [0,1)
 * ranking.
 *
 * This is what keeps "remove 40%" honest. A noise field is bell-shaped, not
 * uniform, so thresholding it at 0.4 removes far less than 40% and the control
 * stops meaning anything. Ranking by quantile makes any field - even, random,
 * or clustered - threshold exactly, so the percentage is the percentage and
 * only the SHAPE of the removal changes.
 */
export function quantileRank(values) {
  const n = values.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => values[a] - values[b]);
  const out = new Float64Array(n);
  // TIES MUST SHARE A RANK. Two holes with the same field value have to get the
  // same verdict, otherwise a hole on one panel edge and its counterpart on the
  // opposite edge - which sample the identical point - can land either side of
  // the threshold, or take different fade scaling, and the boundaries stop
  // matching. Assigning each run of equal values the rank of its first member
  // makes the mapping a true function of the value.
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[idx[j + 1]] === values[idx[i]]) j++;
    const r = n <= 1 ? 0 : i / n;
    for (let k = i; k <= j; k++) out[idx[k]] = r;
    i = j + 1;
  }
  return out;
}

/**
 * Rank blended between blue noise (even) and white noise (random).
 *
 * Blue keeps survivors evenly spread; white clumps. Neither is always right -
 * a dissolve often wants to be *mostly* even with some looseness - so this
 * interpolates. Both inputs are ~uniform on [0,1), so a convex blend is also
 * ~uniform and "remove k%" stays accurate at any mix.
 */
export function rankPointsBlended(pts, seed, randomness) {
  const k = Math.max(0, Math.min(1, randomness));
  if (k >= 1) return rankPoints(pts, seed, 'white');
  const blue = rankPoints(pts, seed, 'blue');
  if (k <= 0) return blue;
  const white = rankPoints(pts, seed, 'white');
  const rank = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i++) rank[i] = blue.rank[i] * (1 - k) + white.rank[i] * k;
  return { rank, fellBack: blue.fellBack };
}

/**
 * Variable-radius circle packing over ONE panel, wrapped.
 *
 * Dart-throwing with shrink-to-fit: pick a point, ask the size field how big a
 * hole wants to be there, then shrink it until it clears every neighbour by the
 * minimum web. Big circles land early and small ones fill the interstices,
 * which is what gives the packed, foam-like read that a lattice cannot.
 *
 * ALL DISTANCES WRAP on the module. That is what keeps the result tileable: a
 * circle near the right edge is tested against circles near the left edge, so
 * the panel butts against a copy of itself with no overlap and no seam. The
 * panel's edges therefore match by construction, exactly as for the tileable
 * noise.
 *
 * Deterministic: every random draw comes from hash2 on the attempt index, so
 * the same seed always yields the same panel.
 */
export function packPanel(p) {
  const W = PANEL.moduleW;
  const H = PANEL.moduleH;
  const seed = p.packSeed ?? p.seed ?? 7;
  const minR = Math.max(p.minDia, LIMITS.minDia) / 2;
  const maxR = Math.max(minR, Math.min(p.maxDia, LIMITS.maxDia) / 2);
  const gap = LIMITS.minGap;
  const density = clamp(p.packDensity ?? 70, 0, 100) / 100;
  const variation = clamp(p.packVariation ?? 60, 0, 100) / 100;

  // Attempts scale with area and with how hard we are pushing: a denser pack
  // needs more darts to find the shrinking gaps.
  const attempts = Math.round(3000 + 22000 * density);

  // Spatial hash so each dart tests a handful of neighbours, not thousands.
  const cell = Math.max(2 * maxR + gap, 20);
  const nx = Math.max(1, Math.ceil(W / cell));
  const ny = Math.max(1, Math.ceil(H / cell));
  const bins = new Map();
  const binKey = (ix, iy) => ((ix % nx) + nx) % nx + ',' + (((iy % ny) + ny) % ny);
  const add = (c) => {
    const k = binKey(Math.floor(c.x / cell), Math.floor(c.y / cell));
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(c);
  };
  const near = (x, y) => {
    const ix = Math.floor(x / cell);
    const iy = Math.floor(y / cell);
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const b = bins.get(binKey(ix + dx, iy + dy));
        if (b) out.push(...b);
      }
    }
    return out;
  };
  // Wrapped separation - the reason the pack tiles.
  const dist = (ax, ay, bx, by) => {
    let dx = Math.abs(ax - bx);
    let dy = Math.abs(ay - by);
    if (dx > W / 2) dx = W - dx;
    if (dy > H / 2) dy = H - dy;
    return Math.hypot(dx, dy);
  };

  const circles = [];
  for (let i = 0; i < attempts; i++) {
    const x = hash2(i, 1, seed) * W;
    const y = hash2(i, 2, seed) * H;
    // Desired size: the modulation field sets the local scale, then a seeded
    // draw spreads sizes so large and small circles interleave.
    const t = clamp(sizeFieldAt(x, y, p), 0, 1);
    const want = lerp(minR, maxR, t);
    const draw = hash2(i, 3, seed);
    const target = lerp(want, lerp(minR, want, draw), variation);

    let r = target;
    for (const c of near(x, y)) {
      const room = dist(x, y, c.x, c.y) - c.r - gap;
      if (room < r) r = room;
      if (r < minR) break;
    }
    if (r < minR) continue;
    const cc = { x, y, r: Math.min(r, maxR) };
    circles.push(cc);
    add(cc);
  }
  return circles;
}

/**
 * Size field for the packer: the same modulation drivers the lattice uses, so
 * a gradient or a cloud field steers hole SIZE here too.
 */
function sizeFieldAt(x, y, p) {
  const f = { fieldW: PANEL.moduleW, fieldH: PANEL.moduleH };
  let t = clamp(modulate(x, y, p, f), 0, 1);
  if (p.invert) t = 1 - t;
  if (p.gamma !== 1) t = Math.pow(t, Math.max(0.05, p.gamma));
  t = stepLevels(t, p);
  return t;
}

/**
 * Cut the driver into levels, so size lands on one of a few values instead of
 * anywhere on the ramp. Two levels is the useful case - a hole is big or it is
 * small - and the boundary between them is then as sharp as the driver's own
 * contour, which is what draws a block edge.
 */
function stepLevels(t, p) {
  const n = Math.max(1, Math.round(p.sizeLevels ?? 1));
  if (n < 2) return t;
  if (n === 2) return t >= clamp(p.sizeSplit ?? 50, 1, 99) / 100 ? 1 : 0;
  return Math.min(n - 1, Math.floor(t * n)) / (n - 1);
}

/** Which tile of the set a panel is, as an index. P1 / WALL have one tile. */
export function tileVariant(tiling, panelCol, panelRow) {
  // 0..3 under P4, so each tile drives its fields from its own seed and the
  // four panels are genuinely different rather than one part repeated.
  //
  // Their EDGES still agree exactly. tileBlend() falls to 0 within a band of
  // every panel edge, so in that band every variant evaluates tile 0s field -
  // identical values, and because ties share a quantile rank and the modulation
  // value is quantised at source, identical values give identical verdicts.
  // That is what makes the match exact rather than merely close; an earlier
  // version of this had neither fix, which is why the boundaries drifted.
  if (tiling !== 'P4') return 0;
  const c = ((panelCol % 2) + 2) % 2;
  const r = ((panelRow % 2) + 2) % 2;
  return r * 2 + c;
}

/**
 * How much of a panel's OWN character applies at a point: 0 on the panel edge,
 * rising to 1 in the interior.
 *
 * This is what lets four DIFFERENT tiles still butt together. Near an edge
 * every tile falls back to one shared field, so all four carry an identical
 * boundary; away from the edge each follows its own seed and diverges.
 * Measured from the nearest edge in both axes, so corners agree too.
 *
 * Wider band = safer matching but more similar tiles. Narrower = more contrast
 * between tiles, reconciled in a tighter zone.
 */
export function tileBlend(x, y, width) {
  if (width <= 0) return 1;
  const dx = Math.min(x, PANEL.moduleW - x);
  const dy = Math.min(y, PANEL.moduleH - y);
  return smooth(clamp(Math.min(dx, dy) / width, 0, 1));
}

/** Which of the four tiles a panel is. P1 / WALL are a single tile. */
export function tileLabelFor(tiling, col, row) {
  if (tiling !== 'P4') return 'A';
  const c = ((col % 2) + 2) % 2;
  const r = ((row % 2) + 2) % 2;
  return r === 0 ? (c === 0 ? 'A' : 'B') : c === 0 ? 'C' : 'D';
}

/** Row/column pitch + per-row phase offset for each lattice family. */
/**
 * Snap a row spacing so a panel holds a WHOLE, EVEN number of rows.
 *
 * Whole, so a hole row lands exactly on the horizontal joint. Even, because a
 * staggered lattice alternates its row offset - an odd count would restart the
 * stagger out of phase at every panel, and the offset rows would not line up
 * across the joint.
 */
/**
 * Column spacing snapped so a panel holds a WHOLE, EVEN number of columns -
 * the same guarantee snapRowSpacing gives vertically, applied to the other
 * axis. A column has to land on the vertical joint for the pattern to carry
 * across it, and an even count keeps a staggered lattice in phase.
 */
function snapColSpacing(px) {
  const cols = Math.max(2, Math.round(PANEL.moduleW / px / 2) * 2);
  return PANEL.moduleW / cols;
}

function snapRowSpacing(py) {
  const rows = Math.max(2, Math.round(PANEL.moduleH / py / 2) * 2);
  return PANEL.moduleH / rows;
}

/**
 * Distance to the NEAREST neighbouring hole centre, which is what actually
 * bounds the hole size - not the column pitch.
 *
 * maxDiaFor() has always been fed the column pitch, which was right only while
 * rows and columns were locked together. With a row-spacing control, packing
 * the rows to a third leaves a vertical web of a millimetre while the check
 * still reports the column web of twenty-eight, and nothing complains. On a
 * staggered family the closest neighbour is not straight up either: it is the
 * offset row, half a column across and one row down.
 */
export function nearestSpacing(p) {
  const { px, py, offset, vertical } = latticeSpacing(p);
  // WHERE THE NEAREST HOLE ACTUALLY IS ON A STAGGERED LATTICE.
  //
  // Taking min(px, py) counts a neighbour that is not there: with the rows
  // offset, nothing sits directly above a hole - the next hole straight up is
  // two rows away, and the closest hole in the adjacent row is off to the
  // side. Measured on a 45 degree screen (px 50, py 25, offset 0.5) the true
  // nearest centre distance is 35.36 mm while this returned 25.00, which
  // capped holes at 22 mm when 32.36 was safe. The error was on the safe side
  // but it cost a third of the hole size.
  //
  // Along the un-staggered axis the neighbour is one step; along the staggered
  // one it is TWO, with the offset hole in between and to the side.
  const f = Math.abs((offset ?? 0) % 1);
  const side = Math.min(f, 1 - f);
  const lattice = !offset
    ? Math.min(px, py)
    : vertical
      ? Math.min(py, 2 * px, Math.hypot(px, py * side))
      : Math.min(px, 2 * py, Math.hypot(px * side, py));
  // Inside a stamp the neighbour is the next hole in the group, which is much
  // closer than any lattice node. Ignoring it would let the cap pass a group
  // whose own members overlap - but only the WIDTH faces that gap, not the
  // length, so it does not bound the length the way the lattice does. The
  // length cap stays the lattice; the width is checked in the stamp itself.
  return lattice;
}

/** Centre-to-centre gap a stamp can actually use, given the hole width. */
export function stampGapFor(p, holeWidth) {
  const want = Math.max(0, p.stampGap ?? 12);
  return Math.max(want, holeWidth + LIMITS.minGap);
}

function latticeSpacing(p) {
  const px = resolvePitch(p).pitch;
  // Whatever the family decides, the row spacing is scaled by the aspect and
  // then snapped to a whole EVEN number of rows per module - so a row still
  // lands on the horizontal joint and a staggered lattice restarts in phase.
  const asp = Math.max(0.05, (p.latticeAspect ?? 100) / 100);
  const rows = (py) => (asp === 1 ? py : snapRowSpacing(py * asp));
  switch (p.lattice) {
    case 'hex':
      // True hex spacing is px * sqrt(3)/2, which almost never divides the
      // panel. Snapped to the nearest spacing that does, so the lattice still
      // meets the joint; the cells end up very slightly off-regular.
      return { px, py: rows(snapRowSpacing(px * (Math.sqrt(3) / 2))), offset: 0.5 };
    // FLAT-TOP triangular lattice: columns staggered instead of rows.
    //
    // The ordinary hex family is pointy-top, and its three edge directions come
    // out at 0, 60 and 120 degrees - no vertical. Transposing the stagger puts
    // them at 30, 90 and 150 instead, which is the same lattice turned a sixth
    // of a turn. Doing it by transposing rather than by rotating the field is
    // what keeps every hole centre on a joint: a rotated lattice cannot land on
    // both panel edges at once, which is why rotation is otherwise banned here.
    case 'hexV': {
      const py2 = rows(px);
      // AN EXACT TRIANGLE, WITH ITS COLUMNS ON THE PANEL JOINT.
      //
      // Both at once is possible, but only by driving the lattice from the
      // COLUMN instead of the row. Snap the column spacing so it divides 600
      // an even number of times - that puts a vertical line on both panel
      // edges and keeps the stagger in phase across the joint - and then take
      // the row spacing from it, py = px * 2/sqrt(3). The triangle stays exact:
      // its vertical side is py and its diagonals hypot(px, py/2), which is py
      // again when px = py*sqrt(3)/2.
      //
      // The row spacing no longer divides 1200, so it is the horizontal joint
      // that the lattice misses now rather than the vertical one. Only one of
      // the two can be met - 1200/py works out to a multiple of sqrt(3) - and
      // the vertical joint is the one that was asked for.
      //
      // Note that 'pitch' therefore sets the COLUMN spacing here, and the
      // triangle side comes out 1.155 times it.
      if (p.placement === 'asanoha') {
        const col = snapColSpacing(px);
        return { px: col, py: (col * 2) / Math.sqrt(3), offset: 0.5, vertical: true };
      }
      return { px: snapColSpacing(px * (Math.sqrt(3) / 2)), py: py2, offset: 0.5, vertical: true };
    }
    case 'stagger':
      // px already divides the panel (600/n), and 1200/px = 2n rows - already
      // whole and even, so at aspect 100 this needs no snapping.
      return { px, py: rows(px), offset: 0.5 };
    case 'brick':
      return { px, py: rows(px), offset: clamp(p.staggerFrac, 0, 1) };
    default:
      return { px, py: rows(px), offset: 0 };
  }
}

const gcd = (a, b) => (b ? gcd(b, Math.abs(a) % Math.abs(b)) : Math.abs(a));

/**
 * How many holes the driver actually gets sampled at, per box, on each axis.
 *
 * This is the number the whole aliasing problem turns on. The driver is a
 * continuous field, but it is only ever READ at hole centres - so what the
 * pattern can express is limited by how many distinct phases those centres
 * land on, not by the field itself.
 */
export function sampleCounts(p) {
  const { px, py } = latticeSpacing(p);
  const per = driverPeriod(p);
  return { nx: Math.max(1, Math.round(per.w / px)), ny: Math.max(1, Math.round(per.h / py)) };
}

/** Distinct phases a cycle count k resolves against n sample points. */
export function phasesFor(k, n) {
  return n / gcd(Math.max(1, Math.round(k)), n);
}

/** Nearest cycle count that resolves every sample point. */
function nearestCoprime(k, n, lo, hi) {
  const start = Math.min(hi, Math.max(lo, Math.round(k)));
  for (let d = 0; d <= hi - lo; d++) {
    for (const c of d === 0 ? [start] : [start - d, start + d]) {
      if (c < lo || c > hi) continue;
      if (gcd(c, n) === 1) return c;
    }
  }
  return null;
}

/**
 * ALIASING AUDIT - why a pattern collapses even though it tiles perfectly.
 *
 * A crossed-wave driver with kx cycles across a box holding nx holes is read at
 * phases 2*pi*kx*i/nx. Those repeat every nx/gcd(kx, nx) holes, so when kx and
 * nx share a factor the field is sampled at only a handful of levels - and with
 * removal ranked on the driver, a whole tie group can fall on one side of the
 * threshold and the field empties out. It is not a continuity failure: the
 * design still repeats exactly on the module. It is the lattice being too
 * coarse to see the wave it is carrying.
 *
 * The cure is always the same: make the cycle count coprime with the sample
 * count. Each issue carries the nearest value that does.
 */
// How far removal may miss its target before it counts as broken, in points.
// 10 rather than 5: a few points out is ordinary quantisation on a coarse
// driver and the pattern still reads, while the failures worth stopping for
// overshoot by tens of points or empty the field outright.
export const ALIAS = { cullSlack: 10 };

/**
 * Is the pattern actually broken? Three unambiguous failures only.
 *
 * An earlier version warned whenever the lattice resolved few levels, and that
 * was wrong: a blocks driver at full sharpness is SUPPOSED to have two or three
 * levels, and it flagged a design that was working exactly as drawn. Coarse is
 * a style. What is never a style is asking for 65% removed and getting 100%,
 * or a driver that has flattened to a single value, or a field that emptied.
 */
export function aliasBroken(p, stats) {
  if (!stats || p.modulation === 'uniform') return null;
  if ((stats.candidates ?? 0) > 0 && (stats.placed ?? 0) === 0)
    return 'every hole was removed - the driver has too few distinct values for the threshold to land between them';
  if ((stats.driverLevels ?? 0) === 1)
    return 'the driver has flattened to a single value, so the pattern is not being expressed at all';
  if (
    stats.cullRequested !== null &&
    stats.cullRequested > 0 &&
    Math.abs((stats.cullAchieved ?? 0) - stats.cullRequested) > ALIAS.cullSlack
  )
    return `removal asked for ${stats.cullRequested.toFixed(0)}% but landed on ${(
      stats.cullAchieved ?? 0
    ).toFixed(0)}% - holes share so few driver values that the threshold cannot land where you set it`;
  return null;
}

export function aliasAudit(p, stats) {
  const issues = [];
  if (!aliasBroken(p, stats)) return issues;
  const CROSSED = ['lattice', 'chevron', 'blocks'];
  const { nx, ny } = sampleCounts(p);

  const checkCycles = (key, label, k, n, hi) => {
    const kk = Math.max(1, Math.round(k));
    if (gcd(kk, n) === 1) return;
    const suggest = nearestCoprime(kk, n, 1, hi);
    if (suggest === null || suggest === kk) return;
    issues.push({
      key,
      label,
      value: kk,
      suggest,
      resolved: phasesFor(kk, n),
      best: n,
      note: `${label} ${kk} shares a factor with the ${n} holes it is sampled at, so the driver only resolves ${phasesFor(kk, n)} of them. ${suggest} resolves all ${n}.`,
    });
  };

  if (CROSSED.includes(p.modulation)) {
    checkCycles('crossKx', 'cycles across', p.crossKx ?? 2, nx, 12);
    checkCycles('crossKy', 'cycles down', p.crossKy ?? 4, ny, 24);
  }

  // Wave, axis-aligned only. At an angle the repeat distance along the
  // projection is its own problem, already covered by the continuity banner.
  if (p.modulation === 'wave') {
    const a = ((Math.round(p.modAngle ?? 0) % 360) + 360) % 360;
    const per = driverPeriod(p);
    const along = a === 0 || a === 180 ? { box: per.w, n: nx } : a === 90 || a === 270 ? { box: per.h, n: ny } : null;
    if (along) {
      const wl = Math.max(1, p.wavelength ?? 900);
      const cycles = along.box / wl;
      const whole = Math.max(1, Math.round(cycles));
      const target = nearestCoprime(whole, along.n, 1, Math.max(1, along.n - 1));
      const clean = Math.abs(cycles - whole) < 1e-6 && gcd(whole, along.n) === 1;
      if (!clean && target !== null) {
        const suggest = Math.round((along.box / target) * 1000) / 1000;
        issues.push({
          key: 'wavelength',
          label: 'wavelength',
          value: wl,
          suggest,
          resolved: phasesFor(whole, along.n),
          best: along.n,
          note: `${wl}mm is ${cycles.toFixed(2)} cycles across the ${along.box}mm box. A whole number of cycles keeps it seamless, and a count coprime with the ${along.n} holes keeps it visible - ${suggest}mm gives ${target}.`,
        });
      }
    }
  }

  return issues;
}

/**
 * The repair the fix button applies: the NEAREST settings that survive the
 * same measurement the audit failed on.
 *
 * Two things matter beyond simply passing. The angle is preserved wherever it
 * can be - a diagonal is the reason the cycle counts were chosen, so returning
 * a pattern that works but no longer runs at 45 degrees is not a fix. And every
 * candidate is BUILT and measured rather than reasoned about, because the
 * arithmetic only bounds what the lattice can resolve; the count is what it
 * actually did.
 */
export function aliasFix(p) {
  const CROSSED = ['lattice', 'chevron', 'blocks'];
  const passes = (over) => {
    const merged = { ...p, ...over };
    const f = buildField(merged);
    return !aliasBroken(merged, f.stats);
  };

  if (CROSSED.includes(p.modulation)) {
    const kx = Math.max(1, Math.round(p.crossKx ?? 2));
    const ky = Math.max(1, Math.round(p.crossKy ?? 4));
    const ratio = ky / kx;
    // Same angle first: walk the cycle count out from where it is, keeping the
    // ratio, so 4:8 becomes 3:6 rather than some unrelated pair.
    for (let d = 1; d <= 11; d++)
      for (const m of [kx - d, kx + d]) {
        if (m < 1 || m > 12) continue;
        const cand = { crossKx: m, crossKy: Math.max(1, Math.min(24, Math.round(ratio * m))) };
        if (passes(cand)) return cand;
      }
    // Only if the angle cannot be kept: let the two axes move independently.
    for (let d = 1; d <= 11; d++)
      for (const dx of [-d, d])
        for (let dy = -d; dy <= d; dy++) {
          const cand = { crossKx: kx + dx, crossKy: ky + dy };
          if (cand.crossKx < 1 || cand.crossKx > 12 || cand.crossKy < 1 || cand.crossKy > 24) continue;
          if (passes(cand)) return cand;
        }
    return null;
  }

  if (p.modulation === 'wave') {
    const a = ((Math.round(p.modAngle ?? 0) % 360) + 360) % 360;
    const per = driverPeriod(p);
    const box = a === 90 || a === 270 ? per.h : per.w;
    const wl = Math.max(1, p.wavelength ?? 900);
    const cycles = Math.max(1, Math.round(box / wl));
    // Whole cycles across the box keep it seamless; walking outward from the
    // current count keeps the wave as close to the chosen scale as possible.
    for (let d = 0; d <= 60; d++)
      for (const c of d === 0 ? [cycles] : [cycles - d, cycles + d]) {
        if (c < 1) continue;
        const cand = { wavelength: Math.round((box / c) * 1000) / 1000 };
        if (cand.wavelength < 20 || cand.wavelength > 5000) continue;
        if (passes(cand)) return cand;
      }
    return null;
  }

  return null;
}

/**
 * The two crossing wave families, as exact module harmonics.
 *
 * Family A runs along (+kx, +ky), family B along (+kx, -ky) - mirror images, so
 * together they form a diamond lattice. Both use INTEGER cycle counts over the
 * module, so each is exactly periodic on it and therefore continues across
 * every joint: moving one module in x advances the phase by exactly kx whole
 * cycles, which is no change at all.
 *
 * Free rotation cannot do this. Only directions of the form
 * (kx / moduleW, ky / moduleH) close on the module, which is precisely the set
 * this enumerates.
 */
/**
 * The box the pattern driver is periodic on, and the box its cycle counts are
 * measured against. Everything that needs to agree about "how far is one
 * repeat" - the crossed-wave families, the blocks driver, the noise wrap and
 * the angle/wavelength readouts - goes through here, so the readout can never
 * describe a different box from the one being drawn.
 */
export function driverPeriod(p) {
  // A KIT OF A FIXED NUMBER OF PANELS.
  //
  // WALL sizes the driver to whatever run is being built, so a four-panel run
  // and an eight-panel run are different fields - the four-panel one does not
  // repeat when the wall gets longer. This wraps the driver on a stated number
  // of panels instead, so the same set of panels repeats however long the wall
  // is. P4 cannot do it: it is a 2 x 2 construction with mirroring and four
  // seeds, not a general kit size.
  if ((p.driverScope ?? 'panel') === 'kit') {
    const kc = Math.max(1, Math.round(p.kitCols ?? 4));
    const kr = Math.max(1, Math.round(p.kitRows ?? 2));
    return { w: PANEL.moduleW * kc, h: PANEL.moduleH * kr };
  }
  // WALL means one design across the whole wall, so the RUN is the repeat unit.
  //
  // Returning the module here was a real defect for a photographic field: the
  // noise stayed periodic on 600 x 1200 whatever the tiling, so a wall that was
  // meant not to repeat repeated every panel anyway - visible as the same blob
  // recurring on a grid. Nothing else can wrap a field that large, which is
  // exactly what WALL is for.
  if (p.tiling === 'WALL') {
    const f = fieldSize(p);
    return { w: Math.max(1, f.fieldW), h: Math.max(1, f.fieldH) };
  }
  if ((p.driverScope ?? 'panel') === 'unit') {
    const u = tileUnit(p.tiling);
    return { w: PANEL.moduleW * u.cols, h: PANEL.moduleH * u.rows };
  }
  return { w: PANEL.moduleW, h: PANEL.moduleH };
}

function crossFamilies(x, y, p) {
  const kx = Math.max(0, Math.round(p.crossKx ?? 2));
  const ky = Math.max(0, Math.round(p.crossKy ?? 4));
  const per = driverPeriod(p);
  const px = (2 * Math.PI * kx * x) / per.w;
  const py = (2 * Math.PI * ky * y) / per.h;
  return {
    fa: 0.5 + 0.5 * Math.sin(px + py),
    fb: 0.5 + 0.5 * Math.sin(px - py),
  };
}

/** Diagonal angle the wave counts work out to, in degrees - a readout. */
export function crossAngleDeg(p) {
  const kx = Math.max(0, Math.round(p.crossKx ?? 2));
  const ky = Math.max(0, Math.round(p.crossKy ?? 4));
  const per = driverPeriod(p);
  return (Math.atan2(ky / per.h, kx / per.w) * 180) / Math.PI;
}

/** Effective wavelength of the crossed families, mm - a readout. */
export function crossWavelengthMm(p) {
  const kx = Math.max(0, Math.round(p.crossKx ?? 2));
  const ky = Math.max(0, Math.round(p.crossKy ?? 4));
  const fx = kx / PANEL.moduleW;
  const fy = ky / PANEL.moduleH;
  const f = Math.hypot(fx, fy);
  return f > 0 ? 1 / f : 0;
}

/**
 * The crossed-wave fade shapes, normalised on the FADE FRAME rather than on the
 * panel module.
 *
 * That is the part that matters: whole cycle counts measured against the frame
 * are what keep the fade periodic on the tiling unit, so a lattice fade repeats
 * with the parts instead of drifting across the run. Borrowing the pattern
 * driver's crossFamilies() would have normalised on the module and quietly put
 * four copies inside a P4 block.
 */
function taperCross(x, y, p, nw, nh) {
  const kx = Math.max(1, Math.round(p.taperKx ?? 2));
  const ky = Math.max(1, Math.round(p.taperKy ?? 4));
  const sharp = clamp(p.taperSharp ?? 100, 0, 100) / 100;
  const px = (2 * Math.PI * kx * x) / nw;
  const py = (2 * Math.PI * ky * y) / nh;
  if (p.taperDriver === 'blocks') {
    const gx = 0.5 + 0.5 * Math.cos(px);
    const gy = 0.5 + 0.5 * Math.cos(py);
    return lerp((gx + gy) / 2, Math.min(gx, gy), sharp);
  }
  const fa = 0.5 + 0.5 * Math.sin(px + py);
  const fb = 0.5 + 0.5 * Math.sin(px - py);
  return p.taperDriver === 'chevron'
    ? lerp((fa + fb) / 2, fa * fb, sharp)
    : lerp((fa + fb) / 2, Math.max(fa, fb), sharp);
}

/**
 * THE FADE LAYER - a second, independent field laid over the pattern.
 *
 * Deliberately NOT part of modulate(). The pattern driver is sampled at the
 * TILED point, so under P1/P4 it wraps and repeats per panel - correct for a
 * pattern, fatal for a fade, which has to cross the whole wall exactly once.
 * This is sampled at the true wall position instead, which is also why a faded
 * run is a set of unique panels rather than a repeating kit.
 *
 * Returns 0 where the layer leaves the pattern alone, 1 where it acts fully.
 */
const TAPER_DIRS = {
  right: 0,
  'down-right': 45,
  down: 90,
  'down-left': 135,
  left: 180,
  'up-left': 225,
  up: 270,
  'up-right': 315,
};

/**
 * The frame the fade is measured in - and the whole point of the tile scope.
 *
 * Measured across the wall, a fade turns an N-panel run into N unique parts,
 * because every panel sits at a different point on the ramp. Measured across
 * one panel MODULE and wrapped, the same fade repeats with the tiling, so P1
 * stays one part and P4 stays four however long the run gets. The cost is a
 * reset at every joint: a straight ramp restarts there. Use 'wave', whose
 * wavelength can be set to the module, for a fade that repeats seamlessly.
 */
/** Panels across and down in one repeat of a tiling. P4 is a 2x2 block. */
export function tileUnit(tiling) {
  if (tiling === 'P4') return { cols: 2, rows: 2 };
  return { cols: 1, rows: 1 };
}

/** wrap() from tileSample, with the same seam snap - see the note there. */
function wrapSeam(v, period) {
  let u = v % period;
  if (u < 0) u += period;
  const EPS = 1e-6;
  if (u < EPS || period - u < EPS) u = 0;
  return u;
}

function taperFrame(x, y, p, f) {
  if ((p.taperScope ?? 'tile') === 'tile' && p.tiling !== 'WALL') {
    // THE TILING UNIT, NOT THE PANEL.
    //
    // tileSample() wraps on one module for P1 and P4 alike, because P4's four
    // tiles are told apart by SEED rather than by coordinate extent. Borrowing
    // it here made a P4 fade repeat four times inside the very 2x2 block it was
    // meant to span. The fade has its own wrap for that reason: one repeat of
    // the tiling - 600 x 1200 under P1, 1200 x 2400 under P4 - so the gradient
    // lines up with the parts that actually repeat.
    const unit = tileUnit(p.tiling);
    const w = PANEL.moduleW * unit.cols;
    const h = PANEL.moduleH * unit.rows;
    return { x: wrapSeam(x, w), y: wrapSeam(y, h), w, h };
  }
  return {
    x,
    y,
    w: p.modScope === 'locked' ? Math.max(1, p.spanMm) : f.fieldW,
    h: p.modScope === 'locked' ? Math.max(1, p.spanMm) : f.fieldH,
  };
}

function taperFieldAt(x0, y0, p, f) {
  const fr = taperFrame(x0, y0, p, f);
  const x = fr.x;
  const y = fr.y;
  const nw = fr.w;
  const nh = fr.h;
  const ux = nw ? x / nw : 0;
  const uy = nh ? y / nh : 0;
  const a = rad(TAPER_DIRS[p.taperDir] ?? p.taperAngle ?? 0);
  switch (p.taperDriver ?? 'linear') {
    case 'radial': {
      // 0 at the centre, 1 at the corners - a vignette. 'invert' turns it into
      // a fade that eats outward from the middle instead.
      // Measured across the period rather than in mm, so the figure is
      // INSCRIBED in the box whatever its proportions - see the note on the
      // modulation of the same name.
      const dx = (ux - 0.5) * 2;
      const dy = (uy - 0.5) * 2;
      const m = p.radialShape ?? 2;
      return clamp(minkowski(dx, dy, m) / minkowski(1, 1, m), 0, 1);
    }
    // SYMMETRIC ABOUT THE MIDDLE, ALONG ONE AXIS.
    //
    // Every other fade here has an end it starts from, so it can thin the top
    // or the bottom but not both. This one is 0 down the centre line and 1 at
    // either end of the direction it is pointed along - a radial vignette
    // squashed onto a single axis - which is what leaves a band of full
    // pattern through the middle and lets it fall away above and below.
    case 'band': {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const proj = (ux - 0.5) * c + (uy - 0.5) * s;
      const half = 0.5 * (Math.abs(c) + Math.abs(s));
      return half <= 0 ? 0 : clamp(Math.abs(proj) / half, 0, 1);
    }
    case 'wave': {
      const proj = x * Math.cos(a) + y * Math.sin(a);
      return 0.5 + 0.5 * Math.sin((2 * Math.PI * proj) / Math.max(1, p.taperWavelength ?? 900));
    }
    case 'noise':
      // Wrapped on the RUN, not on the panel module. Module-wrapped noise would
      // repeat the same cloud in every panel, which is a texture, not a fade.
      return clamp(
        tileableFbm(
          x,
          y,
          Math.max(2 * p.pitch, (p.taperWavelength ?? 900) / 2),
          p.taperSeed ?? 11,
          Math.max(1, nw),
          Math.max(1, nh),
          2
        ),
        0,
        1
      );
    case 'lattice':
    case 'chevron':
    case 'blocks':
      return clamp(taperCross(x, y, p, nw, nh), 0, 1);
    // DIRECTIONLESS, in the two senses that mean different things in metal.
    //
    // 'random' gives every hole its own independent draw, so the fade is a
    // grain rather than a gradient - no axis, and no cloud structure either,
    // which is what separates it from 'noise'. Hashed on the position INSIDE
    // the fade frame, so it still repeats with the tiling.
    case 'random':
      return hash2(Math.round(x), Math.round(y), (p.taperSeed ?? 11) + 31);
    // 'even' applies the same amount everywhere. On its own that is just a
    // smaller hole, but pointed at removal it thins the field uniformly, and it
    // is the neutral setting to sit under a gradient built elsewhere.
    case 'even':
      return 1;
    case 'linear':
    default: {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const proj = ux * c + uy * s;
      const lo = Math.min(0, c) + Math.min(0, s);
      const hi = Math.max(0, c) + Math.max(0, s);
      return hi === lo ? 0.5 : clamp((proj - lo) / (hi - lo), 0, 1);
    }
  }
}

/** The layer field alone, invert applied, amount NOT applied. */
function taperUnit(x, y, p, f) {
  const v = taperFieldAt(x, y, p, f);
  const u = p.taperInvert ? 1 - v : v;
  return Math.round(u * 1e9) / 1e9;
}

/** Fade strength at a point: the layer field scaled by its amount. */
function taperAt(x, y, p, f) {
  const amount = clamp(p.taper ?? 0, 0, 100) / 100;
  if (amount <= 0) return 0;
  const v = taperFieldAt(x, y, p, f);
  const s = amount * (p.taperInvert ? 1 - v : v);
  // QUANTISE, same reason as t. Wrapping a large wall coordinate back into the
  // tiling unit leaves ~1e-15 of float error, so the identical local point on
  // two panels got fade values that were not a tie - and two panels that are
  // one part came out microscopically different, which the DXF would then
  // write out as different numbers. Rounding here makes them an exact tie.
  return Math.round(s * 1e9) / 1e9;
}

/** Whether the layer acts on hole size, on removal, or on both. */
function taperTargets(p) {
  const on = clamp(p.taper ?? 0, 0, 100) > 0;
  const target = p.taperTarget ?? 'size';
  return {
    size: on && target !== 'removal' && target !== 'ratio',
    removal: on && target !== 'size' && target !== 'ratio',
    // THE ONLY LAYER THAT CAN DRAW A FIGURE LARGER THAN A PANEL.
    //
    // tileSample() wraps the main driver on ONE module under P4 - the four
    // parts are told apart by seed, not by where they sit - so any figure the
    // driver draws is at most one panel across and is then repeated on each.
    // The fade has its own frame on the tiling unit (see taperFrame), so
    // pointing it at the shape's proportion is what lets four panels assemble
    // a single diamond instead of each carrying a copy of one.
    ratio: on && target === 'ratio',
  };
}

/**
 * One cycle of a wave, phase u in [0,1) -> value in [0,1].
 *
 * All four are phase-aligned to the sine: 0.5 and rising at u = 0, peaking at
 * u = 0.25. Without that, changing the shape would also shift the pattern
 * sideways, which reads as the wave having moved rather than changed.
 *
 * A note on what these mean in metal: 'sine' and 'triangle' grade hole size
 * continuously, so they read as a soft ripple. 'square' has only two hole
 * sizes, min and max, so it reads as hard stripes - and 'sawtooth' ramps up
 * then drops in one step, which is the only one of the four with a built-in
 * hard edge every cycle.
 */
// Largest length that divides both a and b, to a tolerance. A grid step has to
// divide every period translation as the frame it lives in sees them, or the
// grid does not land back on itself where the repeat wraps.
function gcdApprox(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  if (y > x) {
    const t = x;
    x = y;
    y = t;
  }
  for (let k = 0; k < 60 && y > 1e-6; k++) {
    const t = x - y * Math.floor(x / y + 1e-9);
    x = y;
    y = t;
  }
  return x;
}

function waveform(u, shape) {
  const p = ((u % 1) + 1) % 1;
  switch (shape) {
    case 'triangle': {
      const q = (p + 0.25) % 1;
      return 1 - Math.abs(2 * q - 1);
    }
    case 'sawtooth':
      return (p + 0.25) % 1;
    case 'square':
      return p < 0.5 ? 1 : 0;
    case 'sine':
    default:
      return 0.5 + 0.5 * Math.sin(2 * Math.PI * p);
  }
}

/**
 * Orientation for one hole, in radians, from the lattice index and position.
 *
 * 'radial' and 'tangential' point at the nearest motif centre, and the centre
 * grid is snapped to a whole number of cells per module - the same rule pitch
 * follows - so the motif meets itself at the joint instead of drifting.
 */
/** Nearest motif centre on the coarse hexagonal grid the rosettes sit on. */
function motifCentre(p, x, y) {
  const want = Math.max(2, p.motifMm ?? 200);
  const cell = PANEL.moduleW / Math.max(1, Math.round(PANEL.moduleW / want));
  const rowH = PANEL.moduleH / Math.max(1, Math.round(PANEL.moduleH / (cell * (Math.sqrt(3) / 2))));
  // TRUE NEAREST POINT ON A TRIANGULAR LATTICE.
  //
  // Rounding the row and then the column - which is what this did before - is
  // nearest-on-a-RECTANGULAR-grid. On a staggered grid it pulls every node to
  // a centre in its own row, so the angle to that centre barely varies along a
  // row and the field reads as stripes however large the motif gets. The
  // standard fix is cube rounding: round all three axial coordinates, then
  // correct whichever moved furthest, which is the only one that can be wrong.
  const r = y / rowH;
  const q = (x - (r * cell) / 2) / cell;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { x: rq * cell + (rr * cell) / 2, y: rr * rowH };
}

/** Lattice index counts inside one repeat of the tiling. */
function tileIndexCounts(p) {
  const { px, py } = latticeSpacing(p);
  const u = p.tiling === 'WALL' ? { cols: 1, rows: 1 } : tileUnit(p.tiling);
  return {
    nx: Math.max(1, Math.round((PANEL.moduleW * u.cols) / px)),
    ny: Math.max(1, Math.round((PANEL.moduleH * u.rows) / py)),
  };
}

function shapeAngleAt(p, i, j, x, y) {
  const base = rad(p.shapeAngleDeg ?? 0);
  const mod = (a, n) => ((a % n) + n) % n;
  switch (p.shapeAngleMode) {
    // THREE DIRECTIONS, ASSIGNED AT RANDOM PER NODE.
    //
    // Measuring the reference settled this: three directions exactly 60 degrees
    // apart, used in equal numbers, and NO translation maps the field onto
    // itself - the best of every shift tested reached 41%, where a periodic
    // field would reach 95. So the direction is not a function of position at
    // all, the way a wave or a rosette would be; it is a draw. Hashed on the
    // lattice index INSIDE the tiling repeat, so it is a fixed draw that still
    // repeats with the parts.
    case 'random3': {
      const c = tileIndexCounts(p);
      const h = hash2(mod(i, c.nx), mod(j, c.ny), (p.shapeAngleSeed ?? 3) * 131 + 17);
      return base + Math.min(2, Math.floor(h * 3)) * (Math.PI / 3);
    }
    case 'alt2':
      return base + mod(i + j, 2) * (Math.PI / 2);
    case 'tri':
      return base + mod(i + 2 * j, 3) * (Math.PI / 3);
    // SPOKES - radial, but SNAPPED to sixths of a turn.
    //
    // A continuous radial angle varies smoothly from node to node, and on a
    // triangular lattice that reads as banding rather than as a rosette: the
    // eye groups the gradual change into rows. Snapping to 60 degrees gives
    // six directions around each centre and nothing in between, which is what
    // a hemp-leaf motif actually is - three orientations, since a dash has no
    // head or tail and 60 degrees apart repeats every 180.
    case 'spokes': {
      const c = motifCentre(p, x, y);
      const step = Math.PI / 3;
      return base + Math.round(Math.atan2(y - c.y, x - c.x) / step) * step;
    }
    case 'radial':
    case 'tangential': {
      // The centres sit on a HEXAGONAL grid, not a square one.
      //
      // A square grid of centres was the first attempt and it looked wrong for
      // the reason the hemp-leaf motif exists at all: six slots can only close
      // into a rosette if the thing they point away from is itself surrounded
      // six-fold. On a square grid they point at four corners and the field
      // reads as drifting rather than radiating.
      //
      // Both spacings are snapped to whole cells per module, the same rule
      // pitch follows, so the motif meets itself at the joint.
      const c = motifCentre(p, x, y);
      const a = Math.atan2(y - c.y, x - c.x);
      return base + a + (p.shapeAngleMode === 'tangential' ? Math.PI / 2 : 0);
    }
    default:
      return base;
  }
}

// Decoded luminance grids, keyed by the base64 itself. Decoding per hole
// would be thousands of times per render; the string is the natural key
// because two designs with the same picture share the same work.
const lumCache = new Map();
function lumGrid(p) {
  const b64 = p.imageLum || '';
  const w = Math.max(0, Math.round(p.imageW || 0));
  const h = Math.max(0, Math.round(p.imageH || 0));
  if (!b64 || !w || !h) return null;
  let g = lumCache.get(b64);
  if (!g) {
    const bin =
      typeof atob === 'function'
        ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        : new Uint8Array(Buffer.from(b64, 'base64'));
    if (bin.length < w * h) return null;
    g = bin;
    if (lumCache.size > 8) lumCache.clear();
    lumCache.set(b64, g);
  }
  return { w, h, data: g };
}

/**
 * Bilinear sample of the picture at a wall position.
 *
 * 'cover' and 'contain' preserve the picture's aspect against the wall's, which
 * matters more here than in a photo viewer: stretching a water surface to a
 * 2:1 wall turns ripples into stripes, and that is a change to the design, not
 * to the framing.
 */
/**
 * The rectangle the picture is laid across, and therefore the rectangle it
 * repeats on. One helper because the sampling and the sample point have to
 * agree about it exactly - if they ever disagreed the picture would slide.
 */
function imageBox(p, f) {
  const scope = p.imageScope ?? 'wall';
  if (scope === 'block') {
    return {
      w: PANEL.moduleW * Math.max(1, Math.round(p.imageCols ?? 5)),
      h: PANEL.moduleH * Math.max(1, Math.round(p.imageRows ?? 2)),
      wrap: true,
    };
  }
  if (scope === 'unit' && p.tiling !== 'WALL') {
    const t = tileUnit(p.tiling);
    return { w: PANEL.moduleW * t.cols, h: PANEL.moduleH * t.rows, wrap: true };
  }
  return { w: Math.max(1, f.fieldW), h: Math.max(1, f.fieldH), wrap: false };
}

function imageAt(x, y, p, f) {
  const g = lumGrid(p);
  if (!g) return 0.5;
  const box = imageBox(p, f);
  const W = box.w;
  const H = box.h;
  let u = x / W;
  let v = y / H;
  const fit = p.imageFit ?? 'cover';
  if (fit !== 'stretch') {
    const wallAR = W / H;
    const imgAR = g.w / g.h;
    const scale = fit === 'contain' ? (imgAR > wallAR ? wallAR / imgAR : 1) : imgAR > wallAR ? 1 : wallAR / imgAR;
    const sx = imgAR > wallAR ? scale : 1;
    const sy = imgAR > wallAR ? 1 : scale;
    // centre the picture in whichever axis it does not fill
    u = (u - 0.5) / (fit === 'contain' ? sx : 1) * (imgAR > wallAR ? imgAR / wallAR : 1) + 0.5;
    v = (v - 0.5) / (fit === 'contain' ? sy : 1) * (imgAR > wallAR ? 1 : wallAR / imgAR) + 0.5;
  }
  const px = clamp(u, 0, 1) * (g.w - 1);
  const py = clamp(v, 0, 1) * (g.h - 1);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(g.w - 1, x0 + 1);
  const y1 = Math.min(g.h - 1, y0 + 1);
  const fx = px - x0;
  const fy = py - y0;
  const a = g.data[y0 * g.w + x0];
  const b = g.data[y0 * g.w + x1];
  const c = g.data[y1 * g.w + x0];
  const d = g.data[y1 * g.w + x1];
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  const lum = (top + (bot - top) * fy) / 255;
  return clamp(p.imageInvert ? 1 - lum : lum, 0, 1);
}

/** Modulation driver -> t in [0,1] at a point, before invert/gamma. */
function modulate(x, y, p, f) {
  // Normalisation basis: the run itself, or a fixed mm span that does not
  // move when panels are added. See DEFAULTS.modScope.
  const nw = p.modScope === 'locked' ? Math.max(1, p.spanMm) : f.fieldW;
  const nh = p.modScope === 'locked' ? Math.max(1, p.spanMm) : f.fieldH;
  const ux = nw ? x / nw : 0;
  const uy = nh ? y / nh : 0;
  const a = rad(p.modAngle);
  switch (p.modulation) {
    case 'image':
      return imageAt(x, y, p, f);
    case 'uniform':
      return 1;
    case 'linear': {
      // Project onto the modulation axis, then normalise so t spans the
      // whole field no matter the angle.
      const c = Math.cos(a);
      const s = Math.sin(a);
      const proj = ux * c + uy * s;
      const lo = Math.min(0, c) + Math.min(0, s);
      const hi = Math.max(0, c) + Math.max(0, s);
      return hi === lo ? 0.5 : clamp((proj - lo) / (hi - lo), 0, 1);
    }
    case 'radial': {
      // INSCRIBED IN THE PERIOD, NOT MEASURED IN MILLIMETRES.
      //
      // Distance in mm draws a figure of one true shape and then lets the
      // period box cut its sides off: on the P4 unit, which is 1:2, a diamond
      // in mm keeps only its top and bottom points and reads as a band. Both
      // axes are normalised on the period instead, so the figure always fits
      // the box it repeats on - on that unit the diamond's four points land on
      // the middles of its four sides, and four panels assemble one diamond.
      const dx = (ux - p.centerX) * 2;
      const dy = (uy - p.centerY) * 2;
      const m = p.radialShape ?? 2;
      return clamp(1 - minkowski(dx, dy, m) / minkowski(1, 1, m), 0, 1);
    }
    case 'wave': {
      const proj = x * Math.cos(a) + y * Math.sin(a);
      return waveform(proj / Math.max(1, p.wavelength), p.waveShape);
    }

    // BANDS THAT TURN.
    //
    // A wave driver at an angle has straight isolines: the wave shape changes
    // the profile ALONG the axis, never the direction of the bands, so it can
    // run diagonally but it cannot zigzag. 'lattice' and 'chevron' build from
    // the sum and difference of two families, which gives diamonds, not a band
    // that reverses.
    //
    // This folds the axis instead. The band position is offset sideways by a
    // triangle wave of y, so every zigHeight the offset reverses and the band
    // turns back the other way. The slope of each leg comes from the angle, as
    // it would for a straight band.
    case 'zigzag': {
      const per = driverPeriod(p);
      // Whole cycles across the period, so the field still tiles.
      const legs = Math.max(1, Math.round(per.h / Math.max(1, p.zigHeight ?? 600)));
      const P = per.h / legs;
      const u = y / P;
      // Signed triangle in [-1, 1]: the band wanders to one side, then the
      // other, and comes back - it does not reverse the direction of travel.
      const saw = 2 * (u - Math.floor(u + 0.5));
      const tri = 1 - 2 * Math.abs(saw);
      // The band still ADVANCES along the modulation axis; the wander is added
      // on top of that, so it keeps going one way while rising and falling.
      // Folding the axis instead - which is what this did first - made the
      // bands turn back and stop progressing at all.
      const proj = x * Math.cos(a) + y * Math.sin(a) + (p.zigAmp ?? 150) * tri;
      return waveform(proj / Math.max(1, p.wavelength), p.waveShape);
    }
    // Two wave families crossing each other. One family alone gives diagonal
    // stripes; crossing a second at 90 degrees to it turns the stripes into a
    // diamond LATTICE, with the large holes landing where the two families
    // reinforce. This is the mechanism behind the diagonal argyle / moire
    // perforation patterns - it is strictly periodic, not noise, which is why a
    // cluster field can never reproduce it.
    case 'lattice': {
      const { fa, fb } = crossFamilies(x, y, p);
      const sharp = clamp(p.crossSharp ?? 100, 0, 100) / 100;
      // max() keeps a hole large if EITHER family is peaking, so the bands stay
      // continuous and cross. Averaging instead dims the bands where they do
      // not coincide, giving a softer quilted field.
      return lerp((fa + fb) / 2, Math.max(fa, fb), sharp);
    }

    // Same two families, but multiplied rather than maxed: a hole is only large
    // where BOTH peak, so the field breaks into a grid of discrete diamonds
    // instead of continuous bands.
    case 'chevron': {
      const { fa, fb } = crossFamilies(x, y, p);
      const sharp = clamp(p.crossSharp ?? 100, 0, 100) / 100;
      return lerp((fa + fb) / 2, fa * fb, sharp);
    }

    // Two AXIS-ALIGNED waves, combined with min().
  //
    // 'lattice' and 'chevron' both build from the SUM and DIFFERENCE of the two
    // families, so whatever they do, the low ground between the bright areas
    // always runs diagonally - there is no setting of either that produces a
    // straight horizontal-and-vertical dark grid. This drives one wave along x
    // and one along y and takes the lower of the two, so a hole is small if
    // EITHER wave is in its trough: the troughs become continuous straight
    // lines, and the field reads as blocks of full-size holes separated by an
    // orthogonal grid of solid metal. Integer cycle counts keep it tileable,
    // exactly as crossFamilies() does.
    case 'blocks': {
      const kx = Math.max(1, Math.round(p.crossKx ?? 2));
      const ky = Math.max(1, Math.round(p.crossKy ?? 4));
      const per = driverPeriod(p);
      // TURNING THE BLOCKS.
      //
      // The two waves run along x and y, so the blocks come out square to the
      // panel. On a 45 degree dot screen the blocks want to line up with the
      // SCREEN's own axes instead, which is 45 degrees to the panel. Rotating
      // the sample point does that. Default 0 leaves every existing design
      // exactly where it was.
      const ba = rad(p.blockAngle ?? 0);
      const rx = ba === 0 ? x : x * Math.cos(ba) + y * Math.sin(ba);
      const ry = ba === 0 ? y : -x * Math.sin(ba) + y * Math.cos(ba);
      const gx = 0.5 + 0.5 * Math.cos((2 * Math.PI * kx * rx) / per.w);
      const gy = 0.5 + 0.5 * Math.cos((2 * Math.PI * ky * ry) / per.h);
      const sharp = clamp(p.crossSharp ?? 100, 0, 100) / 100;
      // At sharp 0 the two waves simply average, which softens the grid into a
      // quilt; at 100 min() makes the dark lines crisp and continuous.
      return lerp((gx + gy) / 2, Math.min(gx, gy), sharp);
    }

    case 'bands': {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const proj = ux * c + uy * s;
      const lo = Math.min(0, c) + Math.min(0, s);
      const hi = Math.max(0, c) + Math.max(0, s);
      const u = hi === lo ? 0.5 : clamp((proj - lo) / (hi - lo), 0, 0.999);
      const n = Math.max(2, Math.round(p.steps));
      return Math.floor(u * n) / (n - 1);
    }
    case 'checker': {
      const bw = Math.max(1, Math.round(p.steps));
      const cx = Math.floor(x / (p.pitch * bw));
      const cy = Math.floor(y / (p.pitch * bw));
      return (cx + cy) % 2 === 0 ? 1 : 0;
    }
    case 'noise': {
      // The same field the cluster removal uses, so a noise-driven pattern
      // can be shaped the same way instead of only scaled and reseeded.
      // At detail 2 / rough 50 / stretch 100 / skew 0 this is bit-identical
      // to the plain fBm it replaces, so existing designs do not move.
      const per = driverPeriod(p);
      // Snap the sample, not the result: the noise is still tileable because
      // the snap grid is made to divide the period.
      let nx = x;
      let ny = y;
      const snap = Math.max(0, p.noiseSnap ?? 0);
      if (snap > 0) {
        const ba = rad(p.blockAngle ?? 0);
        let c = Math.cos(ba);
        let s = Math.sin(ba);
        // THE GRID HAS TO SURVIVE THE REPEAT.
        //
        // Whole cells across the period line the blocks up with the repeat -
        // but only in the panel's own frame. blockAngle turns the grid, and a
        // turned grid lands back on itself only if it also divides the period
        // translations as the TURNED frame sees them: (per.w*c, -per.w*s) and
        // (per.h*s, per.h*c). Dividing the untuned period instead leaves the
        // grid out of register at the wrap, which draws one hard line every
        // period - a visible seam, once every few panels rather than at every
        // joint, which is what makes it read as a boundary rather than noise.
        //
        // Rectangular cells make rectangular blocks. The reference's blocks are
        // half again as long as they are wide; square cells can only make
        // square ones, whatever else is tuned.
        const sa = Math.max(0.1, (p.noiseSnapAspect ?? 100) / 100);
        const fit = (u, v, want) => {
          const g = gcdApprox(u, v);
          return g > want * 0.4 ? g / Math.max(1, Math.round(g / want)) : 0;
        };
        let stepX = fit(per.w * c, per.h * s, snap);
        let stepY = fit(per.w * s, per.h * c, snap * sa);
        if (!stepX || !stepY) {
          // No grid at this angle holds cells anywhere near the asked-for size.
          // Square to the panel always divides, so fall back to that rather
          // than break the repeat. Only 0 / 45 / 90 fit in general.
          c = 1;
          s = 0;
          stepX = per.w / Math.max(1, Math.round(per.w / snap));
          stepY = per.h / Math.max(1, Math.round(per.h / (snap * sa)));
        }
        const rx = x * c + y * s;
        const ry = -x * s + y * c;
        const qx = (Math.floor(rx / stepX) + 0.5) * stepX;
        const qy = (Math.floor(ry / stepY) + 0.5) * stepY;
        nx = qx * c - qy * s;
        ny = qx * s + qy * c;
      }
      return clamp(
        cloudField(nx, ny, {
          size: Math.max(2 * p.pitch, (p.wavelength ?? 900) / 4),
          aspect: p.noiseAspect ?? 100,
          shear: p.noiseShear ?? 0,
          rough: p.noiseRough ?? 50,
          seed: p.seed,
          periodX: per.w,
          periodY: per.h,
          octaves: Math.max(1, Math.round(p.noiseDetail ?? 2)),
        }),
        0,
        1
      );
    }
    default:
      return 1;
  }
}

/**
 * Build the whole field: panel rects + hole records + stats.
 * Holes carry both field coords (cx, cy - y down) and panel-local coords
 * (localCx, localCy) so the DXF exporter can apply DXF_BUILDER.md section 3
 * without re-deriving anything.
 */
export function buildField(params) {
  const p = { ...DEFAULTS, ...params };
  const f = fieldSize(p);

  const panels = [];
  for (let row = 0; row < p.rows; row++) {
    for (let col = 0; col < p.cols; col++) {
      panels.push({
        col,
        row,
        label: panelLabel(col, row, p.rows),
        ...panelFaceRect(col, row, p),
      });
    }
  }

  // Packed placement replaces the lattice sweep entirely.
  if (p.placement === 'packed') return buildPackedField(p, f, panels);

  const { px, py, offset, vertical } = latticeSpacing(p);
  // One helper so the loop, the edge steps and the angle all read the lattice
  // the same way - a transposed stagger is easy to apply in one place and
  // forget in another.
  const nodeX = (i, j, g = 0) =>
    (vertical ? i * px : (i + (Math.abs(j % 2) === 1 ? offset : 0)) * px) + asaOff(g)[0];
  const nodeY = (i, j, g = 0) =>
    (vertical ? (j + (Math.abs(i % 2) === 1 ? offset : 0)) * py : j * py) + asaOff(g)[1];
  // spectRAL clamps: floor at the laser minimum, ceiling at min(75, pitch - 3).
  // MIN DIA IS CAPPED TOO.
  //
  // maxR took Math.max(minR, ...) so that a min above the max still produced a
  // hole - but that also let min dia override the fabrication limit entirely:
  // asking for 27mm holes on a lattice that can only carry 23 gave 27mm holes
  // and a NEGATIVE web, silently. The pitch is what bounds the hole, whichever
  // end of the range is doing the asking.
  const capR = maxRadiusFor(p);
  const minR = Math.min(Math.max(p.minDia, LIMITS.minDia) / 2, capR);
  const maxR = Math.max(minR, Math.min(p.maxDia / 2, capR));
  // ALWAYS ON GRID. Lattice rotation and jitter are removed: a rotated or
  // jittered lattice cannot put a hole centre on every joint, which is the
  // property that makes the pattern continue across a panel edge.
  const pad = 2 * px;

  // Integer index sweep anchored at the field origin - see CONTINUITY note.
  const i0 = Math.floor(-pad / px);
  const i1 = Math.ceil((f.fieldW + pad) / px);
  const j0 = Math.floor(-pad / py);
  const j1 = Math.ceil((f.fieldH + pad) / py);

  const holes = [];
  const candidates = [];
  const stats = { placed: 0, dropped: 0, shrunk: 0, culled: 0, openArea: 0, perPanel: {} };
  let id = 0;

  // Three edge directions from each node, as (di, dj) steps on the lattice.
  // Only three, not six: an edge belongs to both of its ends, and walking all
  // six from every node would cut every slot twice.
  // On a STAGGERED lattice the diagonal neighbour is not a fixed index step:
  // odd rows are shifted half a column, so the same (di, dj) reaches a
  // different place depending on the row. Using one fixed pair made two of the
  // three families land on wrong neighbours - the direction mix came out
  // 77/6/17 instead of the even thirds the reference has.
  const edgeStep = (e, par) => {
    const odd = Math.abs(par % 2) === 1;
    if (vertical) {
      // Transposed: the un-staggered run is now DOWN a column, and the two
      // diagonals step one column across and half a row up or down.
      if (e === 0) return [0, 1];
      if (e === 1) return odd ? [1, 1] : [1, 0];
      return odd ? [1, 0] : [1, -1];
    }
    if (e === 0) return [1, 0];
    // Each family must keep ONE direction on both parities. Family 1 always
    // steps down-RIGHT (dx = +px/2), family 2 always down-LEFT (dx = -px/2);
    // which index reaches that flips with the row, which is the whole point of
    // a staggered lattice. Holding the index fixed instead made each family
    // alternate between the two diagonals.
    if (e === 1) return odd ? [1, 1] : [0, 1];
    return odd ? [0, 1] : [-1, 1];
  };
  const EDGES = [0, 1, 2];
  const onLines = p.placement === 'lines' || p.placement === 'asanoha';
  const passes = onLines ? EDGES.length : 1;

  // LATTICE COORDINATES.
  //
  // The (i, j) used to walk the field is a brick index, not a basis: stepping i
  // moves half a row on even columns and minus half a row on odd ones. The
  // coarse lattices are cosets of the real basis, so the index has to be
  // converted before its parity means anything.
  const latM = (i) => i;
  const latN = (i, j) => j - Math.floor(i / 2);
  const mod2 = (v) => ((v % 2) + 2) % 2;

  // THREE LATTICES, A THIRD OF A COARSE CELL APART.
  //
  // The coarse triangle is four small ones - side 2s - so a coarse side holds
  // two dashes. Three lattices of that size cannot be kept apart by shifting
  // them along the small lattice: in each direction two of the three would
  // land on the same lines and share their edges, and a dash would sit on two
  // colours at once. Shifting by a third of the COARSE cell instead puts every
  // colour on lines of its own.
  //
  // The coarse basis is 2*a1 and 2*a2, so a third of its cell diagonal is
  // (2*a1 + 2*a2)/3 = (2px/3, py) here. Three steps of that is a coarse
  // lattice vector, so there are exactly three positions and no more. The x
  // part is not a small-lattice vector, which is what makes the three genuinely
  // different - and why they can now collide, and have to be resolved.
  const asaLayerN =
    p.placement === 'asanoha' ? Math.max(1, Math.min(3, Math.round(p.asaLayers ?? 3))) : 1;
  const asaOff = (g) => [(g * 2 * px) / 3, g * py];

  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      for (let gi = 0; gi < asaLayerN; gi++) {
      for (let e = 0; e < passes; e++) {
      let x = nodeX(i, j, gi);
      let y = nodeY(i, j, gi);
      let edgeAng = null;
      let edgeMaxR = null;
      let layer = 0;
      if (onLines) {
        const [di, dj] = edgeStep(e, vertical ? i : j);
        const x2 = nodeX(i + di, j + dj, gi);
        const y2 = nodeY(i + di, j + dj, gi);
        // Midpoint of the edge, then slid along it by a per-edge draw. The
        // draw is hashed on the edge's own index inside the tiling repeat, so
        // the slide is fixed for a given edge and still repeats with the parts.
        const cnt = tileIndexCounts(p);
        const mod = (a, n) => ((a % n) + n) % n;
        const h = hash2(mod(i, cnt.nx) * 3 + e, mod(j, cnt.ny), (p.lineSeed ?? 5) * 733 + 11);
        // THE SLIDE CANNOT LEAVE ITS OWN EDGE.
        //
        // Sliding by a flat percentage let a dash run past the node at the end
        // of its edge, where it met dashes coming in on the other two edges -
        // lines intruding on each other. The travel is bounded so both ends
        // keep a minimum web back from the node, which is a function of how
        // much longer the edge is than the dash: a dash nearly as long as its
        // edge simply cannot move.
        const edgeLen = Math.hypot(x2 - nodeX(i, j, gi), y2 - nodeY(i, j, gi));
        // minGap PER END, not shared between them. Three edges meet at every
        // node at 60 degrees, so two dashes sliding toward the same node close
        // on each other at 2*d*sin(30) = d, where d is how far each end sits
        // from the node. Giving each end a full minGap is what makes that
        // separation minGap as well; halving it, which subtracting once from
        // the total does, let them overlap by 2mm.
        // Three edges meet at 60 degrees, so two dashes that each stop d short
        // of a shared node pass each other at exactly d. Their WIDTHS eat into
        // that before the web does, which is what the first two attempts at
        // this missed: the requirement is d >= minGap + width, not d >= minGap.
        // With a 30mm dash on a 50mm edge that leaves about 5% of travel, so a
        // dash close to the length of its edge is effectively pinned.
        const slotW = (2 * maxR) / Math.max(1.05, p.slotRatio ?? 2.5);
        // The dash lives inside the edge minus a reserved gap at each end.
        // Whatever length was asked for, it is cut to that span - the gap wins,
        // because it is what the neighbouring lines rely on.
        const gapMm = Math.max(0, p.lineGap ?? 0);
        const usable =
          p.placement === 'asanoha'
            ? // The dash is a fixed share of its edge, which sets the end gaps
              // rather than the other way round. Both ends keep (1 - frac)/2 of
              // the edge clear, so dashes on edges that meet at a node stay
              // apart without anything having to check them.
              edgeLen * (clamp(p.asaDashFrac ?? 58, 20, 90) / 100)
            : Math.max(0, edgeLen - 2 * gapMm);
        edgeMaxR = usable / 2;
        const room = Math.max(0, usable / 2 - Math.min(maxR, edgeMaxR));
        const want = ((h - 0.5) * clamp(p.lineFloat ?? 0, 0, 100)) / 100;
        let slide = edgeLen > 0 ? clamp(want, -room / edgeLen, room / edgeLen) : 0;
        // Family 0 is the un-staggered run - vertical under hexV, horizontal
        // under hex. Shifting it is what closes the triangles.
        if (edgeLen > 0) {
          if (e === 0) slide += ((clamp(p.lineShift ?? 0, -100, 100) / 100) * (2 * maxR)) / edgeLen;
          else slide += clamp(p.lineStagger ?? 0, -100, 100) / 100;
        }
        x = (x + x2) / 2 + (x2 - x) * slide;
        y = (y + y2) / 2 + (y2 - y) * slide;
        // THE Y FLIP AT DRAWING TIME IS PART OF THIS ANGLE.
        //
        // shapeVerts builds the slot Y-UP and both writers flip it to screen
        // coordinates, so an angle worked out in field coordinates comes out
        // mirrored once drawn. With -(y2 - y) the drawn axis was (dx, -dy)
        // instead of (dx, dy): invisible on the vertical family, where dx is
        // zero, and a mirror on both diagonals - measured as 491 of 491
        // diagonals mirrored against their own edge. Dropping the negation
        // puts the flip in the angle, so the slot lands along its edge.
        edgeAng = Math.atan2(x2 - nodeX(i, j, gi), y2 - nodeY(i, j, gi));
        if (p.placement === 'asanoha') {
          // ON THE COARSE LATTICE, OR NOT AT ALL.
          //
          // A coarse edge is two small edges end to end, and both of them touch
          // a coarse node - so an edge belongs to this layer exactly when one
          // of its ends is a coarse node, which in the layer's own frame means
          // both lattice indices even.
          const mA = latM(i);
          const nA = latN(i, j);
          const mB = latM(i + di);
          const nB = latN(i + di, j + dj);
          const coarseA = mod2(mA) === 0 && mod2(nA) === 0;
          const coarseB = mod2(mB) === 0 && mod2(nB) === 0;
          if (!coarseA && !coarseB) continue;
          const om = coarseA ? mA : mB;
          const on = coarseA ? nA : nB;
          const cnt2 = tileIndexCounts(p);
          // Wrapped on an even number of cells so the coarse lattice lands the
          // same way in every copy of the tile and the panel still repeats.
          const wrap = (v, n) => {
            const w = Math.max(2, Math.round(n / 2) * 2);
            return ((v % w) + w) % w;
          };
          const keep = clamp(p.asaKeep ?? 55, 0, 100) / 100;
          const dmm = (coarseA ? mB - mA : mA - mB) + 2;
          const dnn = (coarseA ? nB - nA : nA - nB) + 2;
          const hk = hash2(
            wrap(om, cnt2.nx) * 16 + dmm * 4 + dnn,
            wrap(on, cnt2.ny) * 4 + gi,
            (p.cullSeed | 0) * 131 + 17
          );
          if (hk >= keep) continue;
          layer = gi;
        }
      }


      if (x < -px || y < -py || x > f.fieldW + px || y > f.fieldH + py) continue;

      // Which panel face owns this lattice point? Points landing in a
      // reveal / flange band belong to no panel and are simply not cut.
      const hit = panels.find(
        (pn) => x >= pn.x && x <= pn.x + pn.w && y >= pn.y && y <= pn.y + pn.h
      );
      if (!hit) continue;

      // Tiling: modulate at the TRANSFORMED sample point, emit at the true
      // one. P4 reflects at each joint (continuous), P1 wraps (repeats one
      // panel), WALL is one design across the whole wall.
      const sp = tileSample(p.tiling, x, y);
      // The DRIVER point. Separate from sp on purpose: sp stays panel-local
      // because tileBlend() measures its distance to the panel edge, while the
      // driver may be spanning the whole tiling unit.
      const per = driverPeriod(p);
      const dp =
        p.modulation === 'image'
          ? (() => {
              // Wrapped on the picture's own box, so it repeats WITH the parts.
              // Sampling the true position is what makes a photograph one-off;
              // wrapping it is what makes it a tile.
              const b = imageBox(p, f);
              return b.wrap ? { x: wrapSeam(x, b.w), y: wrapSeam(y, b.h) } : { x, y };
            })()
          : per.w === PANEL.moduleW && per.h === PANEL.moduleH
            ? sp
            : { x: wrapSeam(x, per.w), y: wrapSeam(y, per.h) };
      // Per-tile size variation. Each tile drives its size field from its own
      // seed, blended back to tile A's near the panel edge so boundaries still
      // match. Without this the four tiles share one size field and are
      // identical whenever culling is off.
      const variant = tileVariant(p.tiling, hit.col, hit.row);
      const blend = tileBlend(sp.x, sp.y, p.tileBlendMm ?? 150);
      let t;
      if (variant === 0 || blend <= 0) {
        t = clamp(modulate(dp.x, dp.y, p, f), 0, 1);
      } else {
        const shared = clamp(modulate(dp.x, dp.y, p, f), 0, 1);
        const own = clamp(
          modulate(dp.x, dp.y, { ...p, seed: (p.seed ?? 7) + variant * 977 }, f),
          0,
          1
        );
        t = shared * (1 - blend) + own * blend;
      }
      if (p.invert) t = 1 - t;
      if (p.gamma !== 1) t = Math.pow(t, Math.max(0.05, p.gamma));
  t = stepLevels(t, p);
      // QUANTISE ONCE, HERE. The same logical point on two panels can differ in
      // t by ~1e-16. Left alone that dust propagates into the size, the cull
      // threshold and the fade scaling, so panels that should be one part come
      // out microscopically different. Rounding at source makes every
      // downstream comparison an exact tie.
      t = Math.round(t * 1e9) / 1e9;

      let r = lerp(minR, maxR, t);
      // On lines the edge, not the lattice, is what bounds the hole.
      if (edgeMaxR !== null) r = Math.min(r, edgeMaxR);

      // Edge / seam rule. `edgeInset` keeps holes clear of the bend line so
      // no perforation lands in the fold radius.
      const room = Math.min(
        x - (hit.x + p.edgeInset),
        hit.x + hit.w - p.edgeInset - x,
        y - (hit.y + p.edgeInset),
        hit.y + hit.h - p.edgeInset - y
      );
      if (p.seamRule !== 'allow' && room < r) {
        if (p.seamRule === 'drop' || room < LIMITS.minDia / 2) {
          stats.dropped++;
          continue;
        }
        r = room;
        stats.shrunk++;
      }

      const area = holeArea(p.shape, r, p.slotRatio);
      if (area < LIMITS.minPerfArea) {
        stats.dropped++;
        continue;
      }

      const ang = edgeAng !== null ? edgeAng : shapeAngleAt(p, i, j, x, y);
      // The group runs perpendicular to the hole's long axis. Verts are built
      // Y-up and the field is Y-down, so the offset's y is negated - the same
      // flip svgPath() applies, kept in step here rather than discovered later
      // as a group that leans the wrong way.
      let stampN = p.placement === 'stamp' ? Math.max(1, Math.round(p.stampCount ?? 3)) : 1;
      if (stampN > 1) {
        // Each extra hole is an independent draw, so singles come out most
        // common, pairs next, triples rarest - the shape of the distribution
        // measured off the reference rather than a flat pick between 1 and N.
        const keep = clamp(p.stampVary ?? 0, 0, 100) / 100;
        if (keep > 0) {
          const c = tileIndexCounts(p);
          const mod = (a, n) => ((a % n) + n) % n;
          let n = 1;
          for (let k = 1; k < stampN; k++) {
            const h = hash2(mod(i, c.nx), mod(j, c.ny), (p.seed ?? 7) * 977 + k * 31);
            if (h < keep) n++;
            else break;
          }
          stampN = n;
        }
      }
      const stampStep =
        stampN > 1 ? stampGapFor(p, (2 * r) / Math.max(1.05, p.slotRatio ?? 2.5)) : 0;
      for (let sIdx = 0; sIdx < stampN; sIdx++) {
        const off = (sIdx - (stampN - 1) / 2) * stampStep;
        const hx = x + Math.cos(ang) * off;
        const hy = y - Math.sin(ang) * off;
        // Every member of the group is owned by whichever panel it lands in,
        // not by the node's panel: a group straddling a joint is cut by both,
        // exactly as a single hole on the joint already is.
        const own = panels.find(
          (pn) => hx >= pn.x && hx <= pn.x + pn.w && hy >= pn.y && hy <= pn.y + pn.h
        );
        if (!own) continue;
        candidates.push({
          layer,
          type: p.shape,
          cx: hx,
          cy: hy,
          // Carried on the hole, not recomputed downstream, so the SVG and the
          // DXF cannot drift apart about which way a slot points.
          angle: ang,
          ratio: p.slotRatio,
        // Tile-local sample point. Culling is decided on THIS, never on the
        // wall position - see the rank block below.
        sx: sp.x,
        sy: sp.y,
        variant,
        blend,
        r,
        area,
        t,
          panelCol: own.col,
          panelRow: own.row,
          label: own.label,
          localCx: hx - own.x - PANEL.perfInset,
          localCy: hy - own.y - PANEL.perfInset,
        });
      }
      if (p.placement === 'lines' && clamp(p.linePairChance ?? 0, 0, 100) > 0) {
        const cnt2 = tileIndexCounts(p);
        const md = (a, n) => ((a % n) + n) % n;
        const hp = hash2(md(i, cnt2.nx) * 7 + e, md(j, cnt2.ny), (p.lineSeed ?? 5) * 401 + 29);
        if (hp < clamp(p.linePairChance ?? 0, 0, 100) / 100) {
          // In the dash's own frame: mostly along it, stepped sideways.
          const d = (clamp(p.linePairDist ?? 94, 10, 200) / 100) * (2 * maxR);
          const pa = rad(clamp(p.linePairAngle ?? 23, -90, 90));
          // The dash's own frame, in FIELD coordinates. The edge angle now
          // carries the drawing flip, so a slot at angle a runs along
          // (sin a, cos a) here; the sideways vector is the perpendicular of
          // that. Getting this pair wrong steps the partner along a line the
          // dash does not lie on, and the two then cross.
          const ax = Math.sin(ang);
          const ay = Math.cos(ang);
          const bx = Math.cos(ang);
          const by = -Math.sin(ang);
          const px2 = x + (ax * Math.cos(pa) + bx * Math.sin(pa)) * d;
          const py2 = y + (ay * Math.cos(pa) + by * Math.sin(pa)) * d;
          const own2 = panels.find(
            (pn) => px2 >= pn.x && px2 <= pn.x + pn.w && py2 >= pn.y && py2 <= pn.y + pn.h
          );
          if (own2)
            candidates.push({
              isPair: true,
              type: p.shape,
              cx: px2,
              cy: py2,
              angle: ang,
              ratio: p.slotRatio,
              sx: sp.x,
              sy: sp.y,
              variant,
              blend,
              r,
              area,
              t,
              panelCol: own2.col,
              panelRow: own2.row,
              label: own2.label,
              localCx: px2 - own2.x - PANEL.perfInset,
              localCy: py2 - own2.y - PANEL.perfInset,
            });
        }
      }
      }
      }
    }
  }

  // -- SIZE CONTRAST --------------------------------------------------------
  // Remap the size field onto its own quantiles, so the values spread evenly
  // over min..max instead of bunching in the middle. At 100 % the smallest hole
  // really is min dia and the largest really is max dia, which is what gives a
  // field small circles sitting beside large ones rather than a uniform mottle.
  //
  // Ties share a rank (see quantileRank), so two holes sampling the identical
  // point on opposite panel edges still come out the same size.
  const contrast = clamp(p.sizeContrast ?? 0, 0, 100) / 100;
  // A FLAT FIELD HAS NO CONTRAST TO SPREAD, so leave it alone.
  //
  // Ties share the first index's rank, which is what keeps two panels
  // identical - but when EVERY t is identical (driver 'uniform', or any driver
  // with min dia = max dia) that rule puts the whole field on rank 0. Every
  // hole came out at min dia, max dia silently stopped meaning anything, and
  // the fade layer had nothing left to shrink, which is what made it look as
  // though fading simply did not work under a uniform driver.
  let tLo = Infinity;
  let tHi = -Infinity;
  for (const c of candidates) {
    if (c.t < tLo) tLo = c.t;
    if (c.t > tHi) tHi = c.t;
  }
  const flatField = !candidates.length || tHi - tLo < 1e-9;
  if (contrast > 0 && !flatField) {
    // Quantise before ranking. The same logical point on two panels can differ
    // in t by ~1e-16, which is not a tie, so the two land on adjacent quantile
    // ranks and come out ~0.03 mm apart - panels that should be one part end up
    // as several. Rounding to 1e-9 collapses that dust into a real tie.
    const spread = quantileRank(candidates.map((c) => Math.round(c.t * 1e9) / 1e9));
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      c.t = c.t * (1 - contrast) + spread[i] * contrast;
      c.r = lerp(minR, maxR, c.t);
      c.area = holeArea(c.type, c.r, p.slotRatio);
    }
  }

  // -- PARTNER CLEARANCE ----------------------------------------------------
  // A partner is placed by a measured offset, which says nothing about what is
  // already nearby - and measuring the result showed it crowding neighbouring
  // edges by 3.7mm. Rather than fold clearance into the offset and hope, each
  // partner is checked against everything around it and dropped if it does not
  // fit. The offset stays the measured one; only the partners that cannot be
  // cut disappear.
  if (candidates.some((c) => c.isPair)) {
    const segOf = (c) => {
      // Direction of the slot, in FIELD coords. edgeAng is built as
      // atan2(dx, -dy), so the unit vector along the slot is (sin a, -cos a).
      // Using (-sin a, -cos a) mirrors every segment about the vertical axis,
      // which silently checked the wrong geometry - the guard passed designs it
      // should have rejected.
      const ux = Math.sin(c.angle ?? 0);
      const uy = -Math.cos(c.angle ?? 0);
      return {
        x1: c.cx - ux * c.r,
        y1: c.cy - uy * c.r,
        x2: c.cx + ux * c.r,
        y2: c.cy + uy * c.r,
        w: (2 * c.r) / Math.max(1.05, c.ratio ?? 2.5),
      };
    };
    const pd = (px, py, x1, y1, x2, y2) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const L2 = dx * dx + dy * dy;
      let s = L2 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
      s = Math.max(0, Math.min(1, s));
      return Math.hypot(px - (x1 + s * dx), py - (y1 + s * dy));
    };
    const gapOf = (A, B) =>
      Math.min(
        pd(A.x1, A.y1, B.x1, B.y1, B.x2, B.y2),
        pd(A.x2, A.y2, B.x1, B.y1, B.x2, B.y2),
        pd(B.x1, B.y1, A.x1, A.y1, A.x2, A.y2),
        pd(B.x2, B.y2, A.x1, A.y1, A.x2, A.y2)
      ) -
      (A.w + B.w) / 2;
    // bucket by position so this stays linear in the number of holes
    const cell = 4 * maxR + LIMITS.minGap;
    const grid = new Map();
    const key = (c) => Math.floor(c.cx / cell) + ':' + Math.floor(c.cy / cell);
    for (const c of candidates) {
      if (c.isPair) continue;
      const k = key(c);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(c);
    }
    const kept = [];
    for (const c of candidates) {
      if (!c.isPair) {
        kept.push(c);
        continue;
      }
      const gx = Math.floor(c.cx / cell);
      const gy = Math.floor(c.cy / cell);
      let ok = true;
      const A = segOf(c);
      for (let dx = -1; dx <= 1 && ok; dx++)
        for (let dy = -1; dy <= 1 && ok; dy++)
          for (const other of grid.get(gx + dx + ':' + (gy + dy)) || []) {
            if (gapOf(A, segOf(other)) < LIMITS.minGap - 1e-9) ok = false;
            if (!ok) break;
          }
      if (ok) {
        kept.push(c);
        const k = key(c);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(c);
      }
    }
    candidates.length = 0;
    candidates.push(...kept);
  }

  // -- WHAT THE LATTICE ACTUALLY RESOLVES -----------------------------------
  // Counted rather than predicted. The arithmetic says how many phases the
  // cycle counts CAN reach; only counting says how many distinct sizes came
  // out, which is what the eye and the cull threshold both work on. A large
  // tie group is the dangerous one: removal ranks these values, so a group
  // wider than the gap between two thresholds moves all at once.
  {
    const seen = new Map();
    for (const c of candidates) seen.set(c.t, (seen.get(c.t) ?? 0) + 1);
    stats.driverLevels = seen.size;
    stats.driverTieMax = candidates.length ? Math.max(...seen.values()) / candidates.length : 0;
  }

  // -- TAPER ----------------------------------------------------------------
  // Applied to the RADIUS, after size contrast, and never to t.
  //
  // After, because size contrast re-ranks t over the whole field - taper t
  // first and the ranking spreads it straight back out to the full size range,
  // undoing the fade completely. Never to t, because t is also what the
  // gradient cull thresholds against, and a fade should not quietly change how
  // much gets removed.
  //
  // It walks toward min dia rather than toward zero, so the pattern stays
  // readable to the far end instead of dropping below what the laser can cut.
  // To make it disappear entirely, use removal.
  const acts = taperTargets(p);
  if (acts.size && candidates.length) {
    // FADE TOWARD THE PRODUCT FLOOR, NOT TOWARD minR.
    //
    // A plain uniform perforation sets min dia = max dia, so minR IS the hole
    // size and fading toward it changes nothing - the layer appeared dead.
    // practicalFloor is the real floor: below it a hole reads as a pinhole
    // rather than a perforation. Where min dia is already at or under that,
    // this is exactly the old behaviour, so existing designs do not move.
    const floorR = Math.min(minR, LIMITS.practicalFloor / 2);
    for (const c of candidates) {
      const k = 1 - taperAt(c.cx, c.cy, p, f);
      c.r = Math.round((floorR + (c.r - floorR) * k) * 1e9) / 1e9;
      c.area = holeArea(c.type, c.r, p.slotRatio);
      if (c.area < LIMITS.minPerfArea) c.culled = true;
    }
  }

  // -- VANISH ---------------------------------------------------------------
  // Holes are removed WHOLE, at full size - the cluster look - rather than
  // shrunk away. Which ones go is decided by rank, not by position, so the
  // survivors stay evenly spread. 'gradient' scales the cull by the modulation
  // driver, so the field dissolves across the panel instead of thinning out
  // uniformly.
  const cullPct = clamp(p.cull ?? 0, 0, 100) / 100;
  stats.cullRequested = p.cullMode === 'even' ? cullPct * 100 : null;
  stats.candidates = candidates.length;
  const fadeBand = clamp(p.cullFade ?? 0, 0, 100) / 100;
  // Only meaningful with a layer to borrow: with amount 0 there is no field.
  const cullRampsOnFade = p.cullDriver === 'fade' && clamp(p.taper ?? 0, 0, 100) > 0;
  let cullFellBack = false;
  if ((cullPct > 0 || acts.removal) && candidates.length) {
    // RANK IN TILE SPACE, NOT WALL SPACE.
    //
    // Ranking wall positions made every panel's cull set unique, so a 4x2 run
    // needed 8 different parts instead of 4 - the tiling guarantee was silently
    // lost the moment Vanish was switched on. Ranking the tile-local sample
    // point instead means two panels that ARE the same tile get the same
    // removals, so P4 stays 4 parts and P1 stays 1, at any run length.
    //
    // It is also far cheaper: one panel's worth of nodes rather than the whole
    // wall, which keeps the O(N^2) blue-noise walk well inside its cap.
    const key = (c) => `${Math.round(c.sx * 1e3)},${Math.round(c.sy * 1e3)}`;
    const uniq = new Map();
    for (const c of candidates) {
      const k = key(c);
      if (!uniq.has(k)) uniq.set(k, { x: c.sx, y: c.sy });
    }
    const keys = [...uniq.keys()];
    // Legacy 'white' maps onto full randomness so old recipes still load.
    const randomness =
      p.cullOrder === 'white' ? 1 : clamp(p.cullRandom ?? 0, 0, 100) / 100;
    const pts = keys.map((k) => uniq.get(k));
    const cullSeed = p.cullSeed ?? p.seed;

    // ── ONE FIELD PER TILE, RECONCILED AT THE EDGE ───────────────────────
    //
    // Each tile gets its own seed, so its interior is genuinely its own
    // pattern rather than a reflection of tile A. Near the panel edge every
    // tile blends back to tile 0's field, so all of them carry an identical
    // boundary and still butt together in any order.
    //
    // The threshold is then taken ONCE over the pooled values. That is what
    // makes the edge match exactly: two holes on two different tiles that share
    // a field value get the same verdict, which per-tile thresholds would not
    // guarantee.
    const variants = p.tiling === 'P4' ? 4 : 1;
    let fellBack = false;

    const fieldFor = (seedOffset) => {
      if (p.cullShape === 'clouds') {
        const scale = Math.max(2 * px, p.cullScale ?? 400);
        let cloudOctaves = 1;
        while (cloudOctaves < 3 && scale / Math.pow(2, cloudOctaves) >= 2 * px) cloudOctaves++;
        return pts.map((pt) => {
          const cloud = cloudField(pt.x, pt.y, {
            size: scale,
            aspect: p.cullAspect,
            shear: p.cullShear,
            rough: p.cullRough,
            seed: cullSeed + seedOffset,
            periodX: PANEL.moduleW,
            periodY: PANEL.moduleH,
            octaves: cloudOctaves,
          });
          if (randomness <= 0) return cloud;
          const jx = Math.round(pt.x) % Math.round(PANEL.moduleW);
          const jy = Math.round(pt.y) % Math.round(PANEL.moduleH);
          const jitter = hash2(jx, jy, cullSeed + seedOffset + 7);
          return cloud * (1 - randomness) + jitter * randomness;
        });
      }
      const blended = rankPointsBlended(pts, cullSeed + seedOffset, randomness);
      fellBack = fellBack || blended.fellBack;
      return Array.from(blended.rank);
    };

    // Field 0 is the shared one every tile falls back to at its edges.
    const fields = [];
    if (p.cullShape !== 'pattern')
      for (let v = 0; v < variants; v++) fields.push(fieldFor(v * 977));

    const idxByKey = new Map();
    for (let i = 0; i < keys.length; i++) idxByKey.set(keys[i], i);

    // Blend each candidate toward the shared field by its edge weight, then
    // quantile-rank the pooled result so "remove N%" stays exact.
    //
    // 'pattern' skips the scatter/cloud field entirely and ranks the DRIVER
    // instead, which is what gives a geometric edge rather than a dithered one:
    // holes vanish exactly where the pattern falls below the threshold, so a
    // diamond lattice cuts a clean diamond. It is also the only way to keep a
    // pattern sharp at a fine pitch - below about 20 mm the whole legal hole
    // range is 9 mm to pitch-3, a few millimetres of size to modulate, so
    // shrinking holes cannot express the pattern any more. Removing them can.
    const raw = candidates.map((c) => {
      if (p.cullShape === 'pattern') return Math.round(c.t * 1e9) / 1e9;
      const i = idxByKey.get(key(c)) ?? 0;
      const own = fields[Math.min(c.variant ?? 0, fields.length - 1)][i];
      const shared = fields[0][i];
      const w = c.blend ?? 1;
      return shared * (1 - w) + own * w;
    });
    // Same reason as t: dust in the field values would break the ties that the
    // pooled threshold relies on.
    const pooled = quantileRank(raw.map((v) => Math.round(v * 1e9) / 1e9));
    cullFellBack = fellBack;

    for (let ci = 0; ci < candidates.length; ci++) {
      const c = candidates[ci];
      const R = pooled[ci];
      // Threshold scales with the driver in 'gradient' mode, so the field
      // dissolves where the driver is high. With a uniform driver t is 1
      // everywhere, so gradient degrades gracefully to even culling instead of
      // going inert - the old formula used (1 - t), which silently removed
      // NOTHING on a uniform field.
      const fromPct = clamp(p.cullFrom ?? 0, 0, 100) / 100;
      // Squeeze the ramp into a centred band of the driver. Left linear inside
      // the band on purpose: the slope break at the band edge is invisible once
      // the field is a thresholded cloud, and an eased curve would make the
      // control behave differently at 100 than at 99.
      const band = clamp(p.cullBand ?? 100, 1, 100) / 100;
      const ramp = cullRampsOnFade ? taperUnit(c.cx, c.cy, p, f) : c.t;
      const u = band >= 1 ? ramp : clamp((ramp - 0.5) / band + 0.5, 0, 1);
      const base = p.cullMode === 'gradient' ? fromPct + (cullPct - fromPct) * u : cullPct;
      // The layer COMPOSES with removal rather than replacing it: a hole has to
      // survive both, so survival is (1 - base) * (1 - fade). Written as a
      // single threshold so it still thresholds the same rank field, which is
      // what keeps the dissolve nested - holes leave as the fade deepens and
      // never come back.
      const s = acts.removal ? taperAt(c.cx, c.cy, p, f) : 0;
      const T = base + s - base * s;
      if (R < T) {
        c.culled = true;
        continue;
      }
      // FADE BAND: holes just above the threshold shrink toward nothing, so the
      // void has a soft edge instead of a hard rim of full-size holes.
      if (fadeBand > 0) {
        // Band measured directly in rank space: holes from the threshold up to
        // T + fadeBand shrink, everything beyond is full size. A plain width is
        // far easier to reason about than scaling it by the threshold.
        const over = (R - T) / fadeBand;
        if (over < 1) {
          // Ramp down to the SMALLEST hole, not to zero.
          //
          // Scaling the radius toward 0 made holes collapse almost at once and
          // then get culled by the minimum-area rule, so the void ended on a
          // ring of near-invisible dots - a sudden edge, not a fade. Easing
          // between minR and full size instead means the band reads as a real
          // graduation: full, medium, small, then gone at the threshold.
          //
          // The curve is eased at the top only (1 - (1-k)^2), so sizes drop off
          // gently near full size and hold the small end longer, which is where
          // the eye reads the dissolve.
          const k = clamp(over, 0, 1);
          const eased = 1 - (1 - k) * (1 - k);
          c.r = minR + (c.r - minR) * eased;
          c.area = holeArea(c.type, c.r, p.slotRatio);
          if (c.area < LIMITS.minPerfArea) c.culled = true;
        }
      }
    }
  }

  // NOTHING MAY TOUCH ANYTHING.
  //
  // Inside one layer the dashes cannot collide: they sit on the middle 58% of
  // their own edges, so even two meeting at a node keep the end gap. Across
  // layers there is no such guarantee - the three lattices are a third of a
  // coarse cell apart and their edges cross freely - so the field is resolved:
  // walk the dashes in a fixed order and keep one only if it clears everything
  // already kept. The order comes from the local coordinates, so two copies of
  // a tile resolve the same way and the panel still repeats.
  if (p.placement === 'asanoha') {
    const segs = candidates
      .filter((c) => !c.culled)
      .map((c) => {
        const ux = Math.sin(c.angle);
        const uy = Math.cos(c.angle);
        return {
          c,
          x1: c.cx - ux * c.r,
          y1: c.cy - uy * c.r,
          x2: c.cx + ux * c.r,
          y2: c.cy + uy * c.r,
          hw: c.r / (c.ratio || 1),
          pri: hash2(
            Math.round((c.localCx ?? c.cx) * 8),
            Math.round((c.localCy ?? c.cy) * 8),
            ((p.cullSeed | 0) + 7717) | 0
          ),
        };
      });
    segs.sort((a, b) => a.pri - b.pri);
    const pointSeg = (qx, qy, x1, y1, x2, y2) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const L2 = dx * dx + dy * dy;
      let t = L2 ? ((qx - x1) * dx + (qy - y1) * dy) / L2 : 0;
      t = clamp(t, 0, 1);
      return Math.hypot(qx - (x1 + t * dx), qy - (y1 + t * dy));
    };
    // Endpoint distances alone are not the distance between two segments: two
    // that cross in an X have all four ends far apart and would read as clear.
    const crosses = (A, B) => {
      const d = (ax, ay, bx, by, cx2, cy2) => (bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax);
      return (
        d(B.x1, B.y1, B.x2, B.y2, A.x1, A.y1) * d(B.x1, B.y1, B.x2, B.y2, A.x2, A.y2) < 0 &&
        d(A.x1, A.y1, A.x2, A.y2, B.x1, B.y1) * d(A.x1, A.y1, A.x2, A.y2, B.x2, B.y2) < 0
      );
    };
    const gapOf = (A, B) =>
      crosses(A, B)
        ? -(A.hw + B.hw)
        : Math.min(
            pointSeg(A.x1, A.y1, B.x1, B.y1, B.x2, B.y2),
            pointSeg(A.x2, A.y2, B.x1, B.y1, B.x2, B.y2),
            pointSeg(B.x1, B.y1, A.x1, A.y1, A.x2, A.y2),
            pointSeg(B.x2, B.y2, A.x1, A.y1, A.x2, A.y2)
          ) -
          (A.hw + B.hw);
    const cell = Math.max(1, 2 * Math.max(...segs.map((s) => s.c.r), 1) + LIMITS.minGap);
    const bins = new Map();
    for (const s of segs) {
      const gx = Math.floor(s.c.cx / cell);
      const gy = Math.floor(s.c.cy / cell);
      let clash = false;
      for (let dx = -1; dx <= 1 && !clash; dx++)
        for (let dy = -1; dy <= 1 && !clash; dy++) {
          const b = bins.get(gx + dx + ',' + (gy + dy));
          if (!b) continue;
          for (const o of b)
            if (gapOf(s, o) < LIMITS.minGap) {
              clash = true;
              break;
            }
        }
      if (clash) {
        s.c.culled = true;
        continue;
      }
      const k = gx + ',' + gy;
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(s);
    }
  }

  // NO SMALL TRIANGLE MAY CLOSE.
  //
  // Three dashes that meet corner to corner draw a small triangle, and the
  // panel has none anywhere. They arise on their own from the per-node choice,
  // so they have to be broken afterwards: walk the dashes in a fixed order and
  // drop the last one that would close a ring of three.
  //
  // The order comes from the LOCAL coordinates, so the same triangle in two
  // copies of a tile breaks the same way and the panel still repeats.
  if (p.placement === 'asanoha' && (p.asaNoTriangle ?? true)) {
    const live = candidates.filter((c) => !c.culled);
    const segs = live.map((c) => {
      const ux = Math.sin(c.angle);
      const uy = Math.cos(c.angle);
      return {
        c,
        ends: [
          [c.cx - ux * c.r, c.cy - uy * c.r],
          [c.cx + ux * c.r, c.cy + uy * c.r],
        ],
        pri: hash2(
          Math.round((c.localCx ?? c.cx) * 8),
          Math.round((c.localCy ?? c.cy) * 8),
          ((p.cullSeed | 0) + 6421) | 0
        ),
      };
    });
    segs.sort((a, b) => a.pri - b.pri);
    // A corner is two dashes whose nearest ends almost touch. Two dashes that
    // meet at a node leave a gap of about 0.36 of a dash between their ends,
    // so the reach only has to clear that - set wider it also breaks up rings
    // that were never triangles, and the field cannot get dense.
    const reach = 0.55 * (segs.length ? 2 * segs[0].c.r : 1);
    const near = (A, B) => {
      let best = Infinity;
      for (const p1 of A.ends)
        for (const p2 of B.ends) {
          const d = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
          if (d < best) best = d;
        }
      return best;
    };
    const cell = Math.max(1, reach + 2 * (segs.length ? segs[0].c.r : 1));
    const bins = new Map();
    const put = (s) => {
      const k = Math.floor(s.c.cx / cell) + ',' + Math.floor(s.c.cy / cell);
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(s);
    };
    const around = (s) => {
      const gx = Math.floor(s.c.cx / cell);
      const gy = Math.floor(s.c.cy / cell);
      const out = [];
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const b = bins.get(gx + dx + ',' + (gy + dy));
          if (b) out.push(...b);
        }
      return out;
    };
    for (const s of segs) {
      const partners = around(s).filter((o) => near(s, o) < reach);
      let closes = false;
      for (let i = 0; i < partners.length && !closes; i++)
        for (let j = i + 1; j < partners.length; j++)
          if (near(partners[i], partners[j]) < reach) {
            closes = true;
            break;
          }
      if (closes) {
        s.c.culled = true;
        continue;
      }
      put(s);
    }
  }

  // SIZE FROM THE POSITION INSIDE THE STREAK.
  //
  // A driver cannot express this: it only knows where a hole is, not which run
  // it belongs to or how long that run is. So the runs are found after the
  // culling - holes in the same column, one row apart, unbroken - and the size
  // is laid along each one from its own two ends. Reversing half of them keeps
  // the field from reading as one direction of travel.
  if (p.runSize) {
    const step = latticeSpacing(p).py;
    const byCol = new Map();
    for (const c of candidates) {
      if (c.culled) continue;
      const k = Math.round(c.cx * 4);
      if (!byCol.has(k)) byCol.set(k, []);
      byCol.get(k).push(c);
    }
    const flipPct = clamp(p.runFlip ?? 50, 0, 100) / 100;
    // Columns are numbered from their own spacing so the count is the same
    // whatever the pitch, and wrapped on the tiling repeat so the panel still
    // repeats.
    const every = Math.max(1, Math.round(p.runEvery ?? 1));
    const colStep = latticeSpacing(p).px;
    const cnt3 = tileIndexCounts(p);
    for (const [k, list] of byCol) {
      if (every > 1) {
        const ci = Math.round(k / 4 / colStep);
        const span = Math.max(every, Math.round(cnt3.nx / every) * every);
        if ((((ci % span) + span) % span) % every !== 0) {
          for (const c of list) c.culled = true;
          continue;
        }
      }
      list.sort((a, b) => a.cy - b.cy);
      let run = [];
      const lay = () => {
        if (!run.length) return;
        // Too short to read as a streak, or not one of the ones kept: the whole
        // run goes, never part of it.
        if (
          run.length < Math.max(1, Math.round(p.runMin ?? 1)) ||
          hash2(k, Math.round(run[0].cy), ((p.cullSeed | 0) + 8821) | 0) >=
            clamp(p.runKeep ?? 100, 0, 100) / 100
        ) {
          for (const c of run) c.culled = true;
          run = [];
          return;
        }
        const n = run.length;
        if (p.runPeak) {
          // Where the sawtooth crosses this column. It repeats every 'rise' up
          // the wall as well, so the line carries on past the top instead of
          // stopping at one band.
          const per = Math.max(1, p.peakPeriod ?? 1200);
          const rise = Math.max(1, p.peakRise ?? 900);
          const ux = run[0].cx / per;
          const yLine = (ux - Math.floor(ux)) * rise;
          let best = Infinity;
          let at = 0;
          run.forEach((c, i) => {
            const phase = ((c.cy % rise) + rise) % rise;
            // shortest way round the repeat
            const d = Math.min(Math.abs(phase - yLine), rise - Math.abs(phase - yLine));
            if (d < best) {
              best = d;
              at = i;
            }
          });
          const fall = Math.max(1, Math.round(p.peakFall ?? 4));
          run.forEach((c, i) => {
            const u = clamp(Math.abs(i - at) / fall, 0, 1);
            c.r = maxR - (maxR - minR) * u;
            c.area = holeArea(c.type, c.r, p.slotRatio);
            if (c.area < LIMITS.minPerfArea) c.culled = true;
          });
          run = [];
          return;
        }
        const flip =
          hash2(k, Math.round(run[0].cy), ((p.cullSeed | 0) + 5501) | 0) < flipPct;
        run.forEach((c, i) => {
          let u = n > 1 ? i / (n - 1) : 1;
          if (flip) u = 1 - u;
          c.r = minR + (maxR - minR) * u;
          c.area = holeArea(c.type, c.r, p.slotRatio);
          if (c.area < LIMITS.minPerfArea) c.culled = true;
        });
        run = [];
      };
      for (const c of list) {
        if (run.length && Math.abs(c.cy - run[run.length - 1].cy - step) > 0.05 * step) lay();
        run.push(c);
      }
      lay();
    }
  }

  // Proportion last, after size, contrast, taper and removal have all had
  // their say - it reads t, which none of them change, so nothing here can
  // reach back and move a hole that was already placed.
  {
    const q0 = Math.max(1, p.slotRatio ?? 1);
    const q1 = Math.max(1, p.ratioMax ?? 0);
    const k0 = Math.max(0.2, p.shapeCurve ?? 1);
    const k1 = Math.max(0.2, p.curveMax ?? 0);
    const dq = (p.ratioMax ?? 0) > 0;
    const dk = (p.curveMax ?? 0) > 0;
    for (const c of candidates) {
      // The fade's field when it has been pointed at the proportion, the main
      // driver otherwise. Reading one or the other rather than both keeps this
      // a single gradient, which is what the shape can express.
      const t = acts.ratio
        ? clamp(taperAt(c.cx, c.cy, p, f), 0, 1)
        : clamp(c.t, 0, 1);
      if (dq) c.ratio = lerp(q0, q1, t);
      c.curve = dk ? lerp(k0, k1, t) : k0;
      if (dq || dk) c.area = holeArea(c.type, c.r, c.ratio, c.curve);
    }
  }

  for (const c of candidates) {
    if (c.culled) {
      stats.culled++;
      continue;
    }
    holes.push({
      id: id++,
      // Which of the coarse lattices placed this dash. Only meaningful for the
      // asanoha placement; it is what the three colours in the reference are.
      layer: c.layer ?? 0,
      type: c.type,
      cx: c.cx,
      cy: c.cy,
      r: c.r,
      angle: c.angle,
      ratio: c.ratio,
      curve: c.curve,
      area: c.area,
      panelCol: c.panelCol,
      panelRow: c.panelRow,
      localCx: c.localCx,
      localCy: c.localCy,
    });
    stats.placed++;
    stats.openArea += c.area;
    stats.perPanel[c.label] = (stats.perPanel[c.label] || 0) + 1;
  }
  stats.cullFellBack = cullFellBack;

  // -- ARE THE TILE BOUNDARIES INTERCHANGEABLE? -----------------------------
  //
  // Mirror tiling guarantees that the two sides of any ONE joint agree, so the
  // field is continuous. It does NOT guarantee that every joint carries the
  // SAME edge profile: with a monotonic ramp the joints alternate between the
  // low end and the high end (12 mm ... 45 mm ... 12 mm), so A|B matches but
  // A|A would not, and the tiles cannot be laid in an arbitrary order.
  //
  // They become freely interchangeable only when the driver completes a WHOLE
  // number of cycles across a panel, so the design returns to the same value at
  // both panel edges. Measured here rather than assumed: compare the emitted
  // hole sizes on the panel's left edge against its right edge, and likewise
  // top against bottom.
  const edgeProfile = (fixed, axis) => {
    const eps = 1e-6;
    return holes
      .filter((hh) => Math.abs((axis === 'x' ? hh.cx : hh.cy) - fixed) < eps)
      .sort((a, b) => (axis === 'x' ? a.cy - b.cy : a.cx - b.cx))
      .map((hh) => Math.round(hh.r * 2 * 1e4) / 1e4);
  };
  const profilesMatch = (a, b) =>
    a.length > 0 && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-4);

  const xMatch =
    p.cols < 1 ? true : profilesMatch(edgeProfile(0, 'x'), edgeProfile(PANEL.moduleW, 'x'));
  const yMatch =
    p.rows < 1 ? true : profilesMatch(edgeProfile(0, 'y'), edgeProfile(PANEL.moduleH, 'y'));
  stats.edgeMatchX = xMatch;
  stats.edgeMatchY = yMatch;
  // Interchangeable = a tile can sit next to any other tile, in any order.
  stats.tilesInterchangeable = xMatch && yMatch;

  // -- DOES THE PATTERN CONTINUE ACROSS A JOINT? ----------------------------
  //
  // Distinct from the edge check above, and this is the distinction that
  // matters. Under P1/P4 the coordinate WRAPS, so a hole at x = 600 samples the
  // same point as one at x = 0: the two edge profiles are identical by
  // construction and that check can never fail. Identical edges only mean the
  // pattern RESTARTS cleanly - not that it CONTINUES.
  //
  // Tested directly: is the driver periodic on the module? Sample it at (x, y)
  // and again one module away, UNWRAPPED. If those differ, the field restarts
  // mid-cycle and shows a visible break at every seam. This is exact - an
  // earlier version compared size steps either side of a joint and let a
  // diagonal wave through whose jump happened to be small at the sampled rows.
  {
    const probe = (qx, qy) => clamp(modulate(qx, qy, p, f), 0, 1);
    let dx = 0;
    let dy = 0;
    for (let i = 0; i <= 12; i++) {
      for (let j = 0; j <= 12; j++) {
        const qx = (i / 12) * PANEL.moduleW;
        const qy = (j / 12) * PANEL.moduleH;
        dx = Math.max(dx, Math.abs(probe(qx, qy) - probe(qx + PANEL.moduleW, qy)));
        dy = Math.max(dy, Math.abs(probe(qx, qy) - probe(qx, qy + PANEL.moduleH)));
      }
    }
    stats.periodX = dx;
    stats.periodY = dy;
    // 1e-4 of a [0,1] field is well below one step of hole size, so a
    // hand-typed wavelength like 212.132 (the rounded exact value) still
    // counts as seamless; a genuine break is orders of magnitude larger.
    stats.patternContinuous = dx < 1e-4 && dy < 1e-4;
  }

  const faceArea = p.cols * p.rows * PANEL.faceW * PANEL.faceH;
  stats.cullAchieved = stats.candidates ? (stats.culled / stats.candidates) * 100 : 0;
  stats.openPct = faceArea ? (stats.openArea / faceArea) * 100 : 0;
  stats.holeMinDia = holes.length ? Math.min(...holes.map((h) => h.r)) * 2 : 0;
  stats.holeMaxDia = holes.length ? Math.max(...holes.map((h) => h.r)) * 2 : 0;

  return { params: p, ...f, panels, holes, stats };
}

/** Spreadsheet column letter - DXF_BUILDER.md section 4.4. */
/**
 * Tile the packed panel across the run. The pack is generated ONCE and
 * replayed, mirrored per the tile scheme, so a packed wall is still built from
 * 1 part (P1) or 4 (P4) - the same guarantee the lattice path gives.
 */
function buildPackedField(p, f, panels) {
  const pack = packPanel(p);
  const holes = [];
  const stats = { placed: 0, dropped: 0, shrunk: 0, culled: 0, openArea: 0, perPanel: {} };
  let id = 0;

  for (const pn of panels) {
    for (const c of pack) {
      // Mirror within the panel for P4, so B/C/D differ from A while every
      // edge still matches (the pack is periodic, so a mirror preserves that).
      const mirrorX = p.tiling === 'P4' && pn.col % 2 === 1;
      const mirrorY = p.tiling === 'P4' && pn.row % 2 === 1;
      const lx = mirrorX ? PANEL.moduleW - c.x : c.x;
      const ly = mirrorY ? PANEL.moduleH - c.y : c.y;
      const area = holeArea(p.shape, c.r, p.slotRatio);
      if (area < LIMITS.minPerfArea) {
        stats.dropped++;
        continue;
      }
      holes.push({
        id: id++,
        type: p.shape,
        cx: pn.x + lx,
        cy: pn.y + ly,
        r: c.r,
        area,
        panelCol: pn.col,
        panelRow: pn.row,
        localCx: lx - PANEL.perfInset,
        localCy: ly - PANEL.perfInset,
      });
      stats.placed++;
      stats.openArea += area;
      stats.perPanel[pn.label] = (stats.perPanel[pn.label] || 0) + 1;
    }
  }

  const faceArea = p.cols * p.rows * PANEL.moduleW * PANEL.moduleH;
  stats.openPct = faceArea ? (100 * stats.openArea) / faceArea : 0;
  const dias = holes.map((h) => h.r * 2);
  stats.holeMinDia = dias.length ? Math.min(...dias) : 0;
  stats.holeMaxDia = dias.length ? Math.max(...dias) : 0;
  // Periodic pack + mirror => every panel edge carries the same profile.
  stats.edgeMatchX = true;
  stats.edgeMatchY = true;
  stats.tilesInterchangeable = true;
  stats.cullFellBack = false;
  return { params: p, panels, holes, stats, fieldW: f.fieldW, fieldH: f.fieldH };
}

export function colLetter(col) {
  let s = '';
  let n = col;
  for (;;) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    if (n < 26) break;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/** A1 = bottom-left. `row` is canvas-convention (0 = top). */
export function panelLabel(col, row, rows) {
  return colLetter(col) + (rows - row);
}
