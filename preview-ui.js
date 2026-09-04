// prototypes/veil-standard-pattern/preview-ui.js
// Vanilla-JS control surface for the standalone preview harness. It drives the
// SAME pattern-core / exporters modules as the React component - build-preview.mjs
// inlines them into one file so preview.html opens straight off disk with no
// server and no npm install.
//
// This is a harness, not the deliverable. The shipping UI is
// VeilStandardPatternGenerator.jsx. Keep the two in rough feature parity but do
// not port geometry into here - geometry lives in pattern-core.js only.

/* global resolvePitch, buildField, DEFAULTS, LIMITS, PANEL, LATTICES, MODULATIONS, WAVE_SHAPES, SHAPES, aliasAudit, aliasFix, PRESETS, svgPath, toSVG, toDXF, toRecipe, toPayload, download, saveOut, parsePanelGeo */

const state = {
  ...DEFAULTS,
  showGhost: true,
  showFrames: true,
  showSeams: true,
  zoom: 100,
  presetId: '',
  // The design's own name. Lives in state (not just in the text input) so it
  // round-trips through save/load and so the export filenames can use it.
  designName: '',
};

const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElementNS(
    tag === 'svg' ||
      tag === 'g' ||
      tag === 'rect' ||
      tag === 'circle' ||
      tag === 'path' ||
      tag === 'text'
      ? 'http://www.w3.org/2000/svg'
      : 'http://www.w3.org/1999/xhtml',
    tag
  );
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.setAttribute('class', v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) n.append(kid);
  return n;
};

const USES = {
  image: [],
  uniform: [],
  linear: ['modAngle', 'gamma'],
  radial: ['centerX', 'centerY', 'gamma'],
  wave: ['modAngle', 'wavelength', 'waveShape'],
  lattice: ['crossKx', 'crossKy', 'crossSharp', 'gamma'],
  blocks: ['crossKx', 'crossKy', 'crossSharp', 'gamma'],
  chevron: ['crossKx', 'crossKy', 'crossSharp', 'gamma'],
  bands: ['modAngle', 'steps'],
  noise: ['wavelength', 'seed', 'noiseDetail', 'noiseRough', 'noiseAspect', 'noiseShear', 'gamma'],
  checker: ['steps'],
};

const SPEC = [
  { group: 'Preset' },
  {
    key: 'presetId',
    kind: 'select',
    label: 'standard',
    options: () => ['', ...PRESETS.map((p) => p.id)],
    labels: (v) => (v ? PRESETS.find((p) => p.id === v).name : 'Custom'),
  },
  { group: 'Layout' },
  { key: 'cols', kind: 'range', label: 'panels across', min: 1, max: 12, step: 1 },
  { key: 'rows', kind: 'range', label: 'panels high', min: 1, max: 6, step: 1 },
  { group: 'Tiling' },
  {
    key: 'lattice',
    kind: 'select',
    label: 'lattice',
    options: () => ['stagger', 'grid', 'hex'],
    when: (st) => st.placement !== 'packed',
  },
  {
    key: 'placement',
    kind: 'select',
    label: 'placement',
    options: () => ['lattice', 'lines', 'asanoha', 'stamp', 'packed'],
    labels: (v) =>
      ({
        lattice: 'one hole per node',
        lines: 'on the lattice lines',
        asanoha: 'asanoha',
        stamp: 'a group per node',
        packed: 'packed circles',
      })[v],
  },
  { key: 'asaNoTriangle', kind: 'check', label: 'no small triangles', when: (s) => s.placement === 'asanoha' },
  {
    key: 'asaDashFrac',
    kind: 'range',
    label: 'dash / edge',
    min: 20,
    max: 90,
    step: 1,
    unit: '%',
    when: (s) => s.placement === 'asanoha',
  },
  {
    key: 'asaLayers',
    kind: 'range',
    label: 'coarse lattices',
    min: 1,
    max: 3,
    step: 1,
    when: (s) => s.placement === 'asanoha',
  },
  {
    key: 'asaKeep',
    kind: 'range',
    label: 'edges kept',
    min: 1,
    max: 100,
    step: 1,
    unit: '%',
    when: (s) => s.placement === 'asanoha',
  },
  {
    key: 'kitCols',
    kind: 'range',
    label: 'kit panels across',
    min: 1,
    max: 8,
    step: 1,
    when: (s) => s.driverScope === 'kit',
  },
  {
    key: 'kitRows',
    kind: 'range',
    label: 'kit panels down',
    min: 1,
    max: 4,
    step: 1,
    when: (s) => s.driverScope === 'kit',
  },
  {
    key: 'lineGap',
    kind: 'range',
    label: 'clear at each end',
    min: 0,
    max: 40,
    step: 1,
    unit: 'mm',
    when: (s) => s.placement === 'lines',
  },
  {
    key: 'lineShift',
    kind: 'range',
    label: 'shift verticals',
    min: -100,
    max: 100,
    step: 5,
    unit: '%',
    when: (s) => s.placement === 'lines',
  },
  {
    key: 'lineStagger',
    kind: 'range',
    label: 'stagger diagonals',
    min: -50,
    max: 50,
    step: 5,
    unit: '%',
    when: (s) => s.placement === 'lines',
  },
  {
    key: 'linePairChance',
    kind: 'range',
    label: 'paired dashes',
    min: 0,
    max: 100,
    step: 5,
    unit: '%',
    when: (s) => s.placement === 'lines',
  },
  {
    key: 'linePairDist',
    kind: 'range',
    label: 'pair offset',
    min: 20,
    max: 150,
    step: 2,
    unit: '%',
    when: (s) => s.placement === 'lines' && s.linePairChance > 0,
  },
  {
    key: 'linePairAngle',
    kind: 'range',
    label: 'pair angle',
    min: -60,
    max: 60,
    step: 1,
    unit: 'deg',
    when: (s) => s.placement === 'lines' && s.linePairChance > 0,
  },
  {
    key: 'lineFloat',
    kind: 'range',
    label: 'slide along line',
    min: 0,
    max: 60,
    step: 1,
    unit: '%',
    when: (s) => s.placement === 'lines',
  },
  {
    key: 'lineSeed',
    kind: 'range',
    label: 'slide seed',
    min: 1,
    max: 999,
    step: 1,
    when: (s) => s.placement === 'lines',
  },
  {
    key: 'stampCount',
    kind: 'range',
    label: 'holes per group',
    min: 1,
    max: 6,
    step: 1,
    when: (s) => s.placement === 'stamp',
  },
  {
    key: 'stampGap',
    kind: 'range',
    label: 'group spacing',
    min: 4,
    max: 60,
    step: 1,
    unit: 'mm',
    when: (s) => s.placement === 'stamp',
  },
  {
    key: 'packDensity',
    kind: 'range',
    label: 'pack density',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    when: (st) => st.placement === 'packed',
  },
  {
    key: 'packVariation',
    kind: 'range',
    label: 'size variation',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    when: (st) => st.placement === 'packed',
  },
  {
    key: 'tiling',
    kind: 'select',
    label: 'panel tiling',
    options: () => ['P4', 'P1', 'WALL'],
  },
  // Pitch is entered in mm but SNAPPED to an achievable lattice (600 / even n)
  // so a hole centre always lands on a panel joint. The readout shows the
  // snapped value, which is what actually gets cut.
  {
    key: 'pitch',
    kind: 'range',
    label: 'pitch (target)',
    min: 12,
    max: 125,
    step: 1,
    unit: 'mm',
    when: (st) => st.placement !== 'packed',
  },
  {
    key: 'latticeAspect',
    kind: 'range',
    label: 'row spacing',
    min: 20,
    max: 300,
    step: 5,
    unit: '%',
    when: (st) => st.placement !== 'packed',
  },
  { group: 'Perforation' },
  { key: 'shape', kind: 'select', label: 'shape', options: () => SHAPES },
  {
    key: 'slotRatio',
    kind: 'range',
    label: 'length : width',
    min: 1,
    max: 14,
    step: 0.5,
    when: (s) => s.shape === 'slot' || s.shape === 'rhomb',
  },
  {
    key: 'radialShape',
    kind: 'range',
    label: 'radial figure',
    min: 0.5,
    max: 8,
    step: 0.05,
    when: (s) => s.modulation === 'radial' || s.taperDriver === 'radial',
  },
  {
    key: 'shapeCurve',
    kind: 'range',
    label: 'side curve',
    min: 0.3,
    max: 2,
    step: 0.05,
    when: (s) => s.shape === 'rhomb',
  },
  {
    key: 'curveMax',
    kind: 'range',
    label: 'side curve, far end',
    min: 0,
    max: 2,
    step: 0.05,
    when: (s) => s.shape === 'rhomb',
  },
  {
    key: 'ratioMax',
    kind: 'range',
    label: 'widest : narrowest',
    min: 0,
    max: 24,
    step: 0.5,
    when: (s) => s.shape === 'slot' || s.shape === 'rhomb',
  },
  {
    key: 'shapeAngleMode',
    kind: 'select',
    label: 'orientation',
    options: () => ['fixed', 'alt2', 'tri', 'random3', 'spokes', 'radial', 'tangential'],
    labels: (v) =>
      ({
        fixed: 'all the same',
        alt2: 'alternating, 2 ways',
        tri: 'woven, 3 ways',
        random3: 'random, 3 directions',
        spokes: 'spokes, 6 directions',
        radial: 'radiating from centres',
        tangential: 'around centres',
      })[v],
    when: (s) => s.shape !== 'circle',
  },
  {
    key: 'shapeAngleDeg',
    kind: 'range',
    label: 'angle',
    min: 0,
    max: 180,
    step: 5,
    unit: 'deg',
    when: (s) => s.shape !== 'circle',
  },
  {
    key: 'shapeAngleSeed',
    kind: 'range',
    label: 'angle seed',
    min: 1,
    max: 999,
    step: 1,
    when: (s) => s.shape !== 'circle' && s.shapeAngleMode === 'random3',
  },
  {
    key: 'stampVary',
    kind: 'range',
    label: 'group size varies',
    min: 0,
    max: 100,
    step: 5,
    unit: '%',
    when: (s) => s.placement === 'stamp',
  },
  {
    key: 'motifMm',
    kind: 'range',
    label: 'motif size',
    min: 40,
    max: 600,
    step: 10,
    unit: 'mm',
    when: (s) => s.shape !== 'circle' && (s.shapeAngleMode === 'radial' || s.shapeAngleMode === 'tangential'),
  },
  { key: 'minDia', kind: 'range', label: 'min dia', min: 1.5, max: 75, step: 0.5, unit: 'mm' },
  { key: 'maxDia', kind: 'range', label: 'max dia', min: 9, max: 75, step: 0.5, unit: 'mm' },
  { group: 'Modulation' },
  {
    key: 'sizeContrast',
    kind: 'range',
    label: 'size contrast',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  },
  { key: 'modulation', kind: 'select', label: 'driver', options: () => MODULATIONS },
  { key: 'imageLum', kind: 'file', label: 'picture', when: (s) => s.modulation === 'image' },
  {
    key: 'imageFit',
    kind: 'select',
    label: 'fit',
    options: () => ['cover', 'contain', 'stretch'],
    labels: (v) =>
      ({ cover: 'fill the wall (crop)', contain: 'fit inside', stretch: 'stretch to the wall' })[v],
    when: (s) => s.modulation === 'image',
  },
  { key: 'imageInvert', kind: 'check', label: 'invert picture', when: (s) => s.modulation === 'image' },
  {
    key: 'imageScope',
    kind: 'select',
    label: 'picture spans',
    options: () => ['wall', 'unit', 'block'],
    labels: (v) =>
      ({ wall: 'the whole wall (one-off)', unit: 'one tiling repeat', block: 'a block of panels' })[v],
    when: (s) => s.modulation === 'image',
  },
  {
    key: 'imageCols',
    kind: 'range',
    label: 'repeat across',
    min: 1,
    max: 10,
    step: 1,
    unit: 'panels',
    when: (s) => s.modulation === 'image' && s.imageScope === 'block',
  },
  {
    key: 'imageRows',
    kind: 'range',
    label: 'repeat down',
    min: 1,
    max: 6,
    step: 1,
    unit: 'panels',
    when: (s) => s.modulation === 'image' && s.imageScope === 'block',
  },
  {
    key: 'driverScope',
    kind: 'select',
    label: 'driver spans',
    options: () => ['panel', 'unit', 'kit'],
    labels: (v) => (v === 'panel' ? 'one panel' : 'the tiling unit'),
    when: (st) => st.tiling !== 'WALL' && st.modulation !== 'uniform',
  },
  {
    key: 'modAngle',
    kind: 'range',
    label: 'angle',
    min: 0,
    max: 360,
    step: 1,
    unit: 'deg',
    when: (s) => (USES[s.modulation] || []).includes('modAngle'),
  },
  {
    key: 'crossKx',
    kind: 'range',
    label: 'cycles across',
    min: 0,
    max: 12,
    step: 1,
    when: (s) => (USES[s.modulation] || []).includes('crossKx'),
  },
  {
    key: 'crossKy',
    kind: 'range',
    label: 'cycles up',
    min: 0,
    max: 24,
    step: 1,
    when: (s) => (USES[s.modulation] || []).includes('crossKy'),
  },
  {
    key: 'crossSharp',
    kind: 'range',
    label: 'crossing',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    when: (s) => (USES[s.modulation] || []).includes('crossSharp'),
  },
  {
    key: 'sizeLevels',
    kind: 'range',
    label: 'size levels',
    min: 1,
    max: 6,
    step: 1,
  },
  {
    key: 'sizeSplit',
    kind: 'range',
    label: 'level split',
    min: 5,
    max: 95,
    step: 1,
    unit: '%',
    when: (s) => s.sizeLevels === 2,
  },
  {
    key: 'gamma',
    kind: 'range',
    label: 'gamma',
    min: 0.2,
    max: 3,
    step: 0.05,
    when: (s) => (USES[s.modulation] || []).includes('gamma'),
  },
  {
    key: 'zigHeight',
    kind: 'range',
    label: 'zigzag leg',
    min: 100,
    max: 2400,
    step: 50,
    unit: 'mm',
    when: (s) => s.modulation === 'zigzag',
  },
  {
    key: 'zigAmp',
    kind: 'range',
    label: 'wander',
    min: 0,
    max: 600,
    step: 10,
    unit: 'mm',
    when: (s) => s.modulation === 'zigzag',
  },
  {
    key: 'wavelength',
    kind: 'range',
    label: 'wavelength',
    min: 20,
    max: 5000,
    step: 5,
    unit: 'mm',
    when: (s) => (USES[s.modulation] || []).includes('wavelength'),
  },
  {
    key: 'noiseDetail',
    kind: 'range',
    label: 'noise detail',
    min: 1,
    max: 4,
    step: 1,
    when: (s) => (USES[s.modulation] || []).includes('noiseDetail'),
  },
  {
    key: 'noiseRough',
    kind: 'range',
    label: 'noise roughness',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    when: (s) => (USES[s.modulation] || []).includes('noiseDetail'),
  },
  {
    key: 'noiseSnap',
    kind: 'range',
    label: 'noise in squares',
    min: 0,
    max: 400,
    step: 10,
    unit: 'mm',
    when: (s) => s.modulation === 'noise',
  },
  {
    key: 'noiseSnapAspect',
    kind: 'range',
    label: 'block shape',
    min: 20,
    max: 400,
    step: 10,
    unit: '%',
    when: (s) => s.modulation === 'noise' && s.noiseSnap > 0,
  },
  {
    key: 'blockAngle',
    kind: 'range',
    label: 'block angle',
    min: 0,
    max: 90,
    step: 45,
    unit: 'deg',
    when: (s) => s.modulation === 'blocks' || (s.modulation === 'noise' && s.noiseSnap > 0),
  },
  {
    key: 'noiseAspect',
    kind: 'range',
    label: 'noise stretch',
    min: 25,
    max: 400,
    step: 5,
    unit: '%',
    when: (s) => (USES[s.modulation] || []).includes('noiseDetail'),
  },
  {
    key: 'noiseShear',
    kind: 'range',
    label: 'noise skew',
    min: -3,
    max: 3,
    step: 1,
    when: (s) => (USES[s.modulation] || []).includes('noiseDetail'),
  },
  {
    key: 'waveShape',
    kind: 'select',
    label: 'wave shape',
    options: () => WAVE_SHAPES,
    when: (s) => (USES[s.modulation] || []).includes('waveShape'),
  },
  {
    key: 'steps',
    kind: 'range',
    label: 'steps',
    min: 2,
    max: 12,
    step: 1,
    when: (s) => (USES[s.modulation] || []).includes('steps'),
  },
  {
    key: 'seed',
    kind: 'range',
    label: 'seed',
    min: 1,
    max: 999,
    step: 1,
    when: (s) => (USES[s.modulation] || []).includes('seed'),
  },
  {
    key: 'centerX',
    kind: 'range',
    label: 'centre x',
    min: 0,
    max: 1,
    step: 0.01,
    when: (s) => (USES[s.modulation] || []).includes('centerX'),
  },
  {
    key: 'centerY',
    kind: 'range',
    label: 'centre y',
    min: 0,
    max: 1,
    step: 0.01,
    when: (s) => (USES[s.modulation] || []).includes('centerY'),
  },
  { key: 'invert', kind: 'check', label: 'invert', when: (s) => s.modulation !== 'uniform' },
  { group: 'Fade layer' },
  // A SECOND field laid over the pattern. The pattern driver already owns hole
  // size, so without a separate layer a fade and a pattern are the same knob.
  { key: 'taper', kind: 'range', label: 'fade amount', min: 0, max: 100, step: 1, unit: '%' },
  {
    key: 'taperTarget',
    kind: 'select',
    label: 'fade affects',
    options: () => ['size', 'removal', 'both', 'ratio'],
    labels: (v) =>
      ({ size: 'hole size', removal: 'holes vanish', both: 'both', ratio: 'shape proportion' })[v],
    when: (st) => st.taper > 0,
  },
  {
    key: 'taperDriver',
    kind: 'select',
    label: 'fade shape',
    options: () => ['linear', 'band',
      'radial', 'wave', 'noise', 'lattice', 'chevron', 'blocks', 'random', 'even'],
    when: (st) => st.taper > 0,
  },
  {
    key: 'taperScope',
    kind: 'select',
    label: 'fade measured across',
    options: () => ['tile', 'wall'],
    labels: (v) => (v === 'tile' ? 'one tiling repeat' : 'the whole wall'),
    when: (st) => st.taper > 0,
  },
  {
    key: 'taperDir',
    kind: 'select',
    label: 'fade direction',
    options: () => ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'],
    labels: (v) =>
      ({
        right: 'to the right',
        'down-right': 'diagonal, down-right',
        down: 'downward',
        'down-left': 'diagonal, down-left',
        left: 'to the left',
        'up-left': 'diagonal, up-left',
        up: 'upward',
        'up-right': 'diagonal, up-right',
      })[v],
    when: (st) => st.taper > 0 && (st.taperDriver === 'linear' || st.taperDriver === 'wave'),
  },
  {
    key: 'taperWavelength',
    kind: 'range',
    label: 'fade scale',
    min: 200,
    max: 4000,
    step: 50,
    unit: 'mm',
    when: (st) => st.taper > 0 && (st.taperDriver === 'wave' || st.taperDriver === 'noise'),
  },
  {
    key: 'taperSeed',
    kind: 'range',
    label: 'fade seed',
    min: 1,
    max: 999,
    step: 1,
    when: (st) => st.taper > 0 && (st.taperDriver === 'noise' || st.taperDriver === 'random'),
  },
  {
    key: 'taperKx',
    kind: 'range',
    label: 'fade cycles across',
    min: 1,
    max: 12,
    step: 1,
    when: (st) => st.taper > 0 && ['lattice', 'chevron', 'blocks'].includes(st.taperDriver),
  },
  {
    key: 'taperKy',
    kind: 'range',
    label: 'fade cycles down',
    min: 1,
    max: 24,
    step: 1,
    when: (st) => st.taper > 0 && ['lattice', 'chevron', 'blocks'].includes(st.taperDriver),
  },
  {
    key: 'taperSharp',
    kind: 'range',
    label: 'fade sharpness',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    when: (st) => st.taper > 0 && ['lattice', 'chevron', 'blocks'].includes(st.taperDriver),
  },
  { key: 'taperInvert', kind: 'check', label: 'invert fade', when: (st) => st.taper > 0 },
  { key: 'runSize', kind: 'check', label: 'size along streak' },
  {
    key: 'runEvery',
    kind: 'range',
    label: 'every Nth column',
    min: 1,
    max: 6,
    step: 1,
    when: (s) => s.runSize,
  },
  {
    key: 'runKeep',
    kind: 'range',
    label: 'streaks kept',
    min: 1,
    max: 100,
    step: 1,
    unit: '%',
    when: (s) => s.runSize,
  },
  {
    key: 'runMin',
    kind: 'range',
    label: 'shortest streak',
    min: 1,
    max: 12,
    step: 1,
    when: (s) => s.runSize,
  },
  { key: 'runPeak', kind: 'check', label: 'thick end on a sawtooth', when: (s) => s.runSize },
  {
    key: 'peakPeriod',
    kind: 'range',
    label: 'sawtooth run',
    min: 200,
    max: 2400,
    step: 50,
    unit: 'mm',
    when: (s) => s.runSize && s.runPeak,
  },
  {
    key: 'peakRise',
    kind: 'range',
    label: 'sawtooth rise',
    min: 100,
    max: 2400,
    step: 50,
    unit: 'mm',
    when: (s) => s.runSize && s.runPeak,
  },
  {
    key: 'peakFall',
    kind: 'range',
    label: 'falloff',
    min: 1,
    max: 10,
    step: 1,
    when: (s) => s.runSize && s.runPeak,
  },
  {
    key: 'runFlip',
    kind: 'range',
    label: 'streaks reversed',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    when: (s) => s.runSize,
  },
  { group: 'Vanish' },
  // Removes holes WHOLE at full size - the cluster look. To fade instead,
  // leave this at 0 and drop 'min dia' so the driver shrinks holes away.
  { key: 'cull', kind: 'range', label: 'holes removed', min: 0, max: 95, step: 1, unit: '%' },
  {
    key: 'cullDriver',
    kind: 'select',
    label: 'gradient follows',
    options: () => ['pattern', 'fade'],
    labels: (v) => (v === 'pattern' ? 'the pattern driver' : 'the fade layer'),
    when: (st) => st.cull > 0 && st.cullMode === 'gradient' && st.taper > 0,
  },
  {
    key: 'cullMode',
    kind: 'select',
    label: 'removal',
    options: () => ['even', 'gradient'],
    when: (st) => st.cull > 0,
  },
  {
    key: 'cullFrom',
    kind: 'range',
    label: 'removed at start',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    when: (st) => st.cull > 0 && st.cullMode === 'gradient',
  },
  {
    key: 'cullBand',
    kind: 'range',
    label: 'transition width',
    min: 5,
    max: 100,
    step: 5,
    unit: '%',
    when: (st) => st.cull > 0 && st.cullMode === 'gradient',
  },
  {
    key: 'cullFade',
    kind: 'range',
    label: 'edge fade',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    when: (st) => st.cull > 0,
  },
  {
    key: 'cullShape',
    kind: 'select',
    label: 'removal shape',
    options: () => ['scatter', 'clouds', 'pattern'],
    when: (st) => st.cull > 0,
  },
  {
    key: 'cullScale',
    kind: 'range',
    label: 'cluster size',
    min: 60,
    max: 900,
    step: 10,
    unit: 'mm',
    when: (st) => st.cull > 0 && st.cullShape === 'clouds',
  },
  {
    key: 'cullAspect',
    kind: 'range',
    label: 'cluster shape',
    min: 20,
    max: 400,
    step: 5,
    unit: '%',
    when: (st) => st.cull > 0 && st.cullShape === 'clouds',
  },
  {
    key: 'cullShear',
    kind: 'range',
    label: 'cluster lean',
    min: -2,
    max: 2,
    step: 1,
    when: (st) => st.cull > 0 && st.cullShape === 'clouds',
  },
  {
    key: 'cullRough',
    kind: 'range',
    label: 'cluster edge',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    when: (st) => st.cull > 0 && st.cullShape === 'clouds',
  },
  {
    key: 'cullRandom',
    kind: 'range',
    label: 'randomness',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    when: (st) => st.cull > 0,
  },
  {
    key: 'tileBlendMm',
    kind: 'range',
    label: 'tile contrast',
    min: 0,
    max: 400,
    step: 10,
    unit: 'mm',
    when: (st) => st.tiling === 'P4',
  },
  {
    key: 'cullSeed',
    kind: 'range',
    label: 'removal seed',
    min: 1,
    max: 999,
    step: 1,
    when: (st) => st.cull > 0,
  },
  { group: 'Continuity' },
  { key: 'modScope', kind: 'select', label: 'ramp anchor', options: () => ['locked', 'run'] },
  {
    key: 'spanMm',
    kind: 'range',
    label: 'ramp span',
    min: 600,
    max: 12000,
    step: 100,
    unit: 'mm',
    when: (s) => s.modScope === 'locked',
  },
  { group: 'Fabrication' },
  { group: 'Preview' },
  { key: 'showSeams', kind: 'check', label: 'highlight seams' },
  { group: 'Appearance' },
  { key: 'panelColor', kind: 'color', label: 'panel' },
  { key: 'holeColor', kind: 'color', label: 'perforation' },

  { key: 'showFrames', kind: 'check', label: 'panel frames' },
  { key: 'showGhost', kind: 'check', label: 'next panel ghost' },
];

function setValue(key, raw) {
  if (key === 'presetId') {
    state.presetId = raw;
    const preset = PRESETS.find((p) => p.id === raw);
    if (preset)
      Object.assign(
        state,
        DEFAULTS,
        { cols: state.cols, rows: state.rows, gap: state.gap },
        preset.params
      );
    render();
    return;
  }
  state[key] = raw;
  if (key === 'minDia') state.maxDia = Math.max(state.maxDia, raw);
  if (key === 'maxDia') state.minDia = Math.min(state.minDia, raw);
  if (
    !['showGhost', 'showFrames', 'showSeams', 'zoom', 'holeColor', 'panelColor'].includes(key)
  )
    state.presetId = '';
  render();
}

/**
 * Which controls are currently visible, as a string.
 *
 * The rail only needs rebuilding when this changes - i.e. when a `when`
 * condition opens or closes a control. Rebuilding on every value change
 * destroys and recreates the very element being dragged, which cancels the
 * gesture: a native colour picker closes the instant you click, and a slider
 * drag drops after the first move. See render().
 */
function railSignature() {
  const out = [];
  for (const item of SPEC) {
    if (item.group) {
      out.push("g:" + item.group);
      continue;
    }
    if (item.when && !item.when(state)) continue;
    out.push(item.key);
  }
  return out.join("|");
}

/** Refresh the readouts in place, without replacing any element. */
function syncRail() {
  for (const row of document.querySelectorAll(".row")) {
    const num = row.querySelector("input.val");
    const rng = row.querySelector("input[type=range]");
    if (!num || !rng) continue;
    if (document.activeElement !== num) num.value = rng.value;
  }
}

function buildRail() {
  const rail = document.getElementById('rail');
  rail.textContent = '';
  for (const item of SPEC) {
    if (item.group) {
      rail.append(el('div', { class: 'grp' }, item.group));
      continue;
    }
    if (item.when && !item.when(state)) continue;
    const value = state[item.key];
    const row = el('label', { class: 'row' });
    if (TIPS[item.key]) row.dataset.tip = TIPS[item.key];

    if (item.kind === 'color') {
      const inp = el('input', { type: 'color', class: 'swatch' });
      inp.value = String(value || '#000000');
      inp.addEventListener('input', () => setValue(item.key, inp.value));
      row.append(el('span', { class: 'lab' }, item.label), inp);
      rail.append(row);
      continue;
    }
    if (item.kind === 'file') {
      // SAMPLE ONCE, STORE THE GRID.
      //
      // The design keeps the luminance grid, not a path: designs.json has to
      // reopen identically on another machine, and a recipe that points at a
      // file somewhere on a desktop is not a recipe. The grid is capped on its
      // long side because a wall never resolves more than a few hundred holes
      // across, so a bigger picture only inflates the saved file.
      const CAP = 320;
      const inp = el('input', { type: 'file', accept: 'image/*' });
      const info = el('span', { class: 'lab' }, state.imageW ? state.imageW + ' x ' + state.imageH : 'none');
      inp.addEventListener('change', () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const scale = Math.min(1, CAP / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const cv = document.createElement('canvas');
            cv.width = w;
            cv.height = h;
            const cx = cv.getContext('2d');
            cx.drawImage(img, 0, 0, w, h);
            const px = cx.getImageData(0, 0, w, h).data;
            const lum = new Uint8Array(w * h);
            for (let i = 0, j = 0; i < px.length; i += 4, j++) {
              // Rec. 601 luma - the same weighting a greyscale conversion uses,
              // so what the eye reads as dark in the picture is what closes up.
              lum[j] = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) | 0;
            }
            let s = '';
            for (let i = 0; i < lum.length; i += 8192)
              s += String.fromCharCode.apply(null, lum.subarray(i, i + 8192));
            state.imageW = w;
            state.imageH = h;
            state.imageLum = btoa(s);
            render();
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
      row.append(el('span', { class: 'lab' }, item.label), inp, info);
      rail.append(row);
      continue;
    }
    if (item.kind === 'check') {
      const box = el('input', { type: 'checkbox' });
      box.checked = !!value;
      box.addEventListener('change', () => setValue(item.key, box.checked));
      row.append(el('span', { class: 'lab' }, item.label), box);
    } else if (item.kind === 'select') {
      const sel = el('select');
      for (const opt of item.options()) {
        const o = el('option', { value: opt }, item.labels ? item.labels(opt) : opt);
        if (opt === value) o.setAttribute('selected', 'selected');
        sel.append(o);
      }
      sel.addEventListener('change', () => setValue(item.key, sel.value));
      row.append(el('span', { class: 'lab' }, item.label), sel);
    } else {
      // Typable value + slider, mirroring spectRAL sh/trk pairing: the number
      // is an editable input, not a readout, so an exact value can be entered
      // instead of hunted for with the slider.
      const out = el('input', {
        type: 'number',
        class: 'val',
        min: item.min,
        max: item.max,
        step: item.step,
        value,
        inputmode: 'decimal',
      });
      const inp = el('input', {
        type: 'range',
        min: item.min,
        max: item.max,
        step: item.step,
        value,
      });
      // Slider drives the number; committing the number drives the slider.
      inp.addEventListener('input', () => {
        out.value = inp.value;
        setValue(item.key, parseFloat(inp.value));
      });
      const commit = () => {
        const v = parseFloat(out.value);
        if (!Number.isFinite(v)) {
          out.value = String(state[item.key]);
          return;
        }
        // Clamp to the control range, then re-sync both halves so a typed
        // out-of-range value shows what was actually applied.
        const clamped = Math.min(item.max, Math.max(item.min, v));
        out.value = String(clamped);
        inp.value = String(clamped);
        setValue(item.key, clamped);
      };
      out.addEventListener('change', commit);
      out.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          out.blur();
        }
      });
      // Typing must not be hijacked by the label wrapper or the canvas.
      out.addEventListener('click', (e) => e.stopPropagation());
      const unit = item.unit ? el('span', { class: 'unit' }, item.unit) : null;
      const head = el('span', { class: 'valwrap' });
      head.append(out);
      if (unit) head.append(unit);
      row.append(el('span', { class: 'lab' }, item.label), head);
      row.append(inp);
      row.classList.add('stack');
    }
    rail.append(row);
  }
}

function holeNodes(holes, opacity) {
  const g = el('g', { fill: state.holeColor || '#0e0f11', opacity });
  for (const h of holes) {
    const d = svgPath(h);
    g.append(d ? el('path', { d }) : el('circle', { cx: h.cx, cy: h.cy, r: h.r }));
  }
  return g;
}

let current = null;

let lastRailSig = null;

function render() {
  // Rebuild the rail ONLY when the set of visible controls changes. Otherwise
  // the element under the pointer would be swapped out mid-gesture.
  const sig = railSignature();
  if (sig !== lastRailSig) {
    lastRailSig = sig;
    buildRail();
  } else {
    syncRail();
  }
  const field = buildField(state);
  current = field;
  const ghost = state.showGhost ? buildField({ ...state, cols: state.cols + 1 }) : null;
  const ghostHoles = ghost ? ghost.holes.filter((h) => h.panelCol === state.cols) : [];
  const ghostPanel = ghost ? ghost.panels.find((p) => p.col === state.cols && p.row === 0) : null;

  const pad = 60;
  const w = field.fieldW + (ghost ? PANEL.moduleW + state.gap : 0) + pad * 2;
  const h = field.fieldH + pad * 2;
  const svg = el('svg', {
    viewBox: `${-pad} ${-pad} ${w} ${h}`,
    preserveAspectRatio: 'xMidYMid meet',
  });

  // Panel face, painted first so holes and frames sit on top of it. Drawn per
  // panel rather than as one field rect, so the joints stay visible when the
  // face colour is close to the page background.
  for (const pn of field.panels) {
    svg.append(
      el('rect', {
        x: pn.x,
        y: pn.y,
        width: PANEL.moduleW,
        height: PANEL.moduleH,
        fill: state.panelColor || '#eceff3',
      })
    );
  }

  if (state.showFrames) {
    for (const pn of field.panels) {
      svg.append(
        el('rect', {
          x: pn.x - (PANEL.moduleW - PANEL.faceW) / 2,
          y: pn.y - (PANEL.moduleH - PANEL.faceH) / 2,
          width: PANEL.moduleW,
          height: PANEL.moduleH,
          fill: 'none',
          stroke: 'rgba(0,0,0,.18)',
          'stroke-width': 2,
        }),
        el(
          'text',
          {
            x: pn.x + pn.w / 2,
            y: pn.y + pn.h - 16,
            'text-anchor': 'middle',
            'font-size': 42,
            fill: 'rgba(0,0,0,.2)',
          },
          pn.label
        )
      );
    }
  }
  if (state.showSeams) {
    // Every internal joint. Drawn behind the holes deliberately: on top, the
    // line covers the very column of holes centred on the joint, which makes a
    // continuous pattern look like it breaks at each panel edge.
    const step = PANEL.moduleW + state.gap;
    const stepY = PANEL.moduleH + state.gap;
    const seam = { stroke: '#c0392b', 'stroke-width': 6, opacity: 0.5 };
    for (let c = 1; c < state.cols; c++) {
      svg.append(
        el('line', { x1: c * step, y1: 0, x2: c * step, y2: field.fieldH, ...seam })
      );
    }
    for (let r = 1; r < state.rows; r++) {
      svg.append(
        el('line', { x1: 0, y1: r * stepY, x2: field.fieldW, y2: r * stepY, ...seam })
      );
    }
  }
  svg.append(holeNodes(field.holes, 1));

  if (ghostPanel) {
    svg.append(
      el('rect', {
        x: ghostPanel.x - (PANEL.moduleW - PANEL.faceW) / 2,
        y: ghostPanel.y - (PANEL.moduleH - PANEL.faceH) / 2,
        width: PANEL.moduleW,
        height: PANEL.moduleH,
        fill: 'none',
        stroke: 'rgba(0,0,0,.2)',
        'stroke-width': 2,
        'stroke-dasharray': '16 12',
      }),
      holeNodes(ghostHoles, 0.22),
      el(
        'text',
        {
          x: ghostPanel.x + ghostPanel.w / 2,
          y: ghostPanel.y + ghostPanel.h / 2,
          'text-anchor': 'middle',
          'font-size': 34,
          fill: 'rgba(0,0,0,.32)',
        },
        'continues'
      )
    );
  }

  const stage = document.getElementById('stage');

  // ZOOM ABOUT THE CENTRE OF THE WINDOW.
  //
  // Record which point of the drawing is currently at the middle of the
  // viewport, as a fraction of the scrollable content. After resizing the SVG
  // we scroll so that same point is at the middle again. Without this the
  // content is anchored top-left and appears to slide away as you zoom.
  const prevW = stage.scrollWidth || 1;
  const prevH = stage.scrollHeight || 1;
  const fx = (stage.scrollLeft + stage.clientWidth / 2) / prevW;
  const fy = (stage.scrollTop + stage.clientHeight / 2) / prevH;
  const hadContent = stage.childElementCount > 0;

  // Size the SVG in real pixels and let the stage scroll. The viewBox is
  // untouched, so geometry and hit-testing are unaffected.
  const avail = Math.max(120, stage.clientWidth - 40);
  const fitScale = avail / w;
  const px = w * fitScale * (state.zoom / 100);
  svg.setAttribute('width', String(Math.max(80, px)));
  svg.setAttribute('height', String(Math.max(80, (px * h) / w)));
  svg.removeAttribute('preserveAspectRatio');
  stage.textContent = '';
  stage.append(svg);

  const recentre = () => {
    const cx = fx * stage.scrollWidth - stage.clientWidth / 2;
    const cy = fy * stage.scrollHeight - stage.clientHeight / 2;
    stage.scrollLeft = hadContent ? Math.max(0, cx) : (stage.scrollWidth - stage.clientWidth) / 2;
    stage.scrollTop = hadContent ? Math.max(0, cy) : (stage.scrollHeight - stage.clientHeight) / 2;
  };
  recentre();

  const s = field.stats;
  document.getElementById('meta').textContent =
    `${state.cols} x ${state.rows} panels  ${field.fieldW} x ${field.fieldH} mm`;
  document.getElementById('stats').textContent =
    `${s.placed.toLocaleString()} holes   ${s.openPct.toFixed(1)}% open   ` +
    `dia ${s.holeMinDia.toFixed(1)}-${s.holeMaxDia.toFixed(1)}mm   ` +
    `removed ${s.culled}   dropped ${s.dropped}   ` +
    `${Math.round(s.placed / (state.cols * state.rows))}/panel   ` +
    `tile ${state.tiling}   pitch ${resolvePitch(state).pitch.toFixed(1)}mm (target ${state.pitch})`;
  // Boundary report. This is the difference between "the seams look right" and
  // "any tile can go anywhere", which is what makes the set manufacturable as
  // a small kit of parts rather than a fixed sequence.
  // Two separate properties, and conflating them is what hid a real bug: edges
  // can match perfectly while the pattern still restarts mid-cycle at the joint.
  const cont = document.getElementById('cont');
  if (cont) {
    const ok = s.patternContinuous;
    cont.className = ok ? 'edge ok' : 'edge warn';
    cont.textContent = ok
      ? 'Pattern continues across every joint - the design repeats exactly on the 600 x 1200 module.'
      : 'Pattern BREAKS at each joint: this driver does not repeat on the 600 x 1200 module, so it restarts mid-cycle at every panel edge. For a diagonal, use the lattice or chevron driver - its cycle counts are whole numbers, so it always meets itself. For wave, pick a wavelength that divides the projected module (at 45 degrees: 424.3, 212.1, 141.4 ...).';
  }

  // ALIASING. Separate from the continuity banner above on purpose: that one
  // asks whether the design repeats on the module, this one asks whether the
  // lattice is fine enough to SHOW the driver it is carrying. A pattern can
  // tile perfectly and still collapse, which is what makes this its own check.
  const alias = document.getElementById('alias');
  if (alias) {
    const issues = aliasAudit(state, s);
    alias.textContent = '';
    if (!issues.length) {
      alias.className = 'edge ok';
      alias.textContent =
        state.modulation === 'uniform'
          ? 'Uniform driver - no pattern to alias.'
          : `Lattice resolves ${s.driverLevels} distinct levels from the driver, largest group ${(
              100 * s.driverTieMax
            ).toFixed(0)}% of holes.` +
            (s.cullRequested
              ? ` Removal asked for ${s.cullRequested.toFixed(0)}% and landed on ${s.cullAchieved.toFixed(
                  0
                )}%.`
              : '') +
            ' Enough for the pattern to read.';
    } else {
      alias.className = 'edge warn';
      alias.append(
        document.createTextNode(
          `Pattern is ALIASING - it still tiles, but the lattice only resolves ${s.driverLevels} ` +
            `levels and ${(100 * s.driverTieMax).toFixed(0)}% of holes share one of them, so the ` +
            `shape cannot come through and a removal threshold moves them all at once. ` +
            issues.map((i) => i.note).join(' ') + ' '
        )
      );
      const btn = el('button', { class: 'fix' }, 'fix');
      btn.addEventListener('click', () => {
        const patch = aliasFix(state);
        if (!patch) {
          alias.append(
            document.createTextNode(' No nearby setting clears it - try a finer pitch or another driver.')
          );
          return;
        }
        // Working state only. persist() writes the saved-design LIBRARY, which
        // has nothing to do with the value being repaired here.
        Object.assign(state, patch);
        render();
      });
      alias.append(btn);
    }
  }

  const edge = document.getElementById('edge');
  if (edge) {
    const ok = s.tilesInterchangeable;
    // A TRANSITION IS MEANT TO HAVE TWO DIFFERENT EDGES.
    //
    // The ramp starts at one diameter and ends at another, so of course its two
    // edges differ - that is the panel's entire purpose. Telling someone to
    // pick a different driver here would be telling them to stop building the
    // thing they are building.
    const ramp = state.modulation === 'ramp';
    edge.className = ok || ramp ? 'edge ok' : 'edge warn';
    edge.textContent = ramp
      ? 'Transition panel: the two ends are DIFFERENT by design, so it does not tile with itself. It goes once between the two standard panels whose sizes it runs between - check those edges match, not this one.'
      : ok
      ? 'Boundaries identical - every joint carries the same edge, so tiles can be laid in any order (AB, BA, AABB ...).'
      : 'Boundaries alternate - each joint matches its own two sides, so the field is continuous, but ' +
        (s.edgeMatchX ? '' : 'the left and right panel edges differ') +
        (!s.edgeMatchX && !s.edgeMatchY ? ' and ' : '') +
        (s.edgeMatchY ? '' : 'the top and bottom panel edges differ') +
        '. Tiles are not interchangeable: AB works, AA does not. Use a driver that completes whole cycles across a panel (e.g. wave with wavelength 600 or 300), or uniform.';
  }
  const warn = document.getElementById('warn');
  if (!s.placed) {
    warn.style.display = 'block';
    warn.textContent =
      `Nothing is cut: all ${s.dropped} candidates fall under the ${LIMITS.minPerfArea}mm2 minimum ` +
      `perforation area. There is no edge keep-out - holes may straddle a joint.`;
  } else if (s.diaShort && state.minDia !== state.maxDia) {
    // The design states a size range; the field did not deliver it. Usually a
    // ramp spanning further than the panel, or a driver that never reaches its
    // own extreme.
    warn.style.display = 'block';
    warn.textContent =
      `Cut ${s.diaLow}-${s.diaHigh}mm, not the ${s.diaWant[0]}-${s.diaWant[1]}mm asked for. ` +
      `A ramp whose span is longer than the panel only gets part way (check span mm against the ` +
      `panel, or use 'across the run'); noise and radial drivers reach their extremes only where ` +
      `the field happens to peak. On a transition panel the end sizes are the specification.`;
  } else if (s.diaClamped) {
    // The size asked for was not the size delivered. On a transition panel
    // that is the whole specification, so it cannot be left to be noticed.
    warn.style.display = 'block';
    warn.textContent =
      `Max dia ${s.diaAsked}mm does not fit this lattice: it can carry ${s.diaCap}mm, so the ` +
      `largest holes were cut to that. Widen the pitch (or the row spacing) if the ${s.diaAsked}mm ` +
      `end has to be exact - a transition panel that does not reach its end diameter will not ` +
      `match the panel it butts against.`;
  } else {
    warn.style.display = 'none';
  }
}


/**
 * Hover explanations, keyed by control. Ported in spirit from spectRAL
 * ui/tooltips.ts: one delayed bubble, text living in a map rather than in the
 * markup, so a control and its explanation stay together.
 *
 * These say what the option DOES and when to reach for it - a label like
 * "distribution: blue" is meaningless without it.
 */
const TIPS = {
  presetId: 'Load a saved standard. Changing any control below switches this to Custom.',

  cols: 'How many panels wide the run is displayed. Panels are 600 mm modules butted together.',
  rows: 'How many panels tall the run is displayed. Panels are 1200 mm modules.',

  lattice:
    'How the rows line up. Stagger offsets every other row by half a pitch, so each hole sits between two in the row above - a denser, more woven read, and what most perforated panels use. Grid aligns rows squarely. Hex is a true triangular lattice, with its row spacing snapped so the pattern still meets the panel joint.',
  placement:
    'How holes are positioned. Lattice pins every hole to a regular grid, so centres land exactly on panel joints and the pitch control applies - this is the standard perforation. Packed drops the grid and packs circles of varying size against one another, filling gaps with smaller ones, which gives a dense foam-like field. Packing has no pitch.',
  packDensity:
    'How hard circles are pushed together when packed. Low leaves open ground between them; high fills nearly every gap with progressively smaller circles.',
  packVariation:
    'Spread of circle sizes when packed. At 0 every circle is the size the driver asks for; raising it lets small circles appear alongside large, which is what makes a pack read as organic rather than as a bubble grid.',
  tiling:
    'How many DISTINCT panels the wall is built from. 4 panel: a mirrored 2x2 block (A B / C D) that repeats - the pattern reflects at each joint so the field looks continuous. 1 panel: one design repeated, a single part to make, but a gradient restarts at every joint. Whole wall: one design end to end - every panel is a different part.',
  pitch:
    'Target centre-to-centre hole spacing. Capped at 75 mm for this product line. It SNAPS to the nearest spacing a panel can actually hold (600 / an even number), so a hole centre always lands exactly on a panel joint and the pattern runs across the seam. The readout at the bottom shows the snapped value.',

  shape: 'Hole outline. Circle is the standard; the others are for exploration.',
  minDia:
    'Smallest hole the pattern uses - where the driver is at its low end. Below about 12 mm a hole reads as a pinhole rather than a perforation.',
  maxDia:
    'Largest hole the pattern uses - where the driver is at its high end. Capped at 75 mm, and never closer than 3 mm to its neighbour, so a fine pitch limits it further.',

  driverScope:
    'How far the pattern driver reaches before it repeats. ONE PANEL is the original behaviour - the driver restarts in every panel, so under P4 it looks identical in all four tiles and only removal tells them apart. THE TILING UNIT lets it span one whole repeat of the tiling, which under P4 is the 2x2 block, so a wave or a lattice runs across all four tiles. Cycle counts are then measured against that block, not against a panel. Part count is unchanged.',
  runSize:
    'Sizes each unbroken run of holes down a column from one of its own ends to the other, so the gradient belongs to the streak instead of the wall. Min dia and max dia set the two ends.',
  runEvery:
    'Keeps the streaks in every Nth column and clears the rest. This spaces the field out without scattering it - the diagonal the streaks sit on stays continuous, which dropping them at random does not.',
  runKeep:
    'What share of the streaks are kept. They are dropped whole, so thinning the field this way never leaves a stub of one behind.',
  runMin:
    'Streaks shorter than this are removed rather than drawn as a few stray holes.',
  runPeak:
    'Puts the largest hole of every streak where a sawtooth line crosses it, instead of at one of the streak ends. The thick points then climb across the field, drop back, and climb again.',
  peakPeriod:
    'How far the sawtooth runs across before it drops back.',
  peakRise:
    'How far it climbs over one run. It repeats up the wall on the same spacing.',
  peakFall:
    'How many dots it takes to go from the largest hole down to the smallest.',
  runFlip:
    'How many streaks are laid the other way up, so they do not all grow in the same direction.',
  taper:
    'Strength of the fade layer, which sits ON TOP of the pattern driver - so a pattern can fade out without giving up the pattern. 0 turns the layer off. A faded run is a set of unique panels, not a repeating tile.',
  taperTarget:
    'What the layer does. HOLE SIZE shrinks holes toward min dia, so the pattern stays readable but goes quiet. HOLES VANISH removes them instead, so the pattern dissolves to nothing. BOTH shrinks and then removes, which reads as the softest disappearance. SHAPE PROPORTION hands this layer the rhombus proportion instead of the main driver - and it is the only way to draw a figure BIGGER than one panel, because under P4 the main driver wraps on a single module while this layer has its own frame on the whole 2 x 2 repeat.',
  imageLum:
    'The picture the hole sizes are read from. Dark areas close up to the minimum hole, light areas open to the maximum - so a photograph becomes a halftone in metal. The picture is sampled once and the GRID is stored in the design, not a link to the file, so a saved design reopens the same on any machine. Reduced to 320 on its long side, which is finer than any wall resolves.',
  imageScope:
    'What the picture is laid across. THE WHOLE WALL spreads it once over the run - a photograph, and every panel a unique part. ONE TILING REPEAT lays it across a single repeat instead, so P1 becomes one part and P4 becomes four, and the run can be any length. For that to read continuously the picture itself has to meet its own edges, so use a grid that was prepared seamless.',
  imageCols:
    'How many panels across one repeat of the picture spans. Together with repeat down this is the size of the kit: 5 x 2 is ten distinct panels that then tile for any wall length.',
  imageRows: 'How many panels down one repeat spans.',
  imageFit:
    'How the picture is placed on the wall when their proportions differ. FILL crops the overflow, FIT leaves the picture whole and pads, STRETCH distorts it to match - avoid stretch on anything with a real subject, since it changes the design rather than the framing.',
  imageInvert:
    'Swaps light and dark, so the picture reads as a negative - large holes where it was dark.',
  taperDriverBandNote:
    'band - fades from the middle outwards along the chosen direction, so the pattern thins at BOTH ends instead of one.',
  taperDriver:
    'The shape of the fade. LINEAR is a straight ramp across the run. RADIAL is a vignette, strongest at the corners. WAVE fades in and out in bands. NOISE is an irregular, cloud-like fade. LATTICE, CHEVRON and BLOCKS are the crossed-wave shapes from the pattern driver, with their own cycle counts - so the fade can carry a diamond lattice or a block grid while the pattern carries something else. RANDOM has no direction and no clouds either - every hole draws on its own, so it reads as grain or sparkle. EVEN applies the same amount everywhere.',
  taperKx:
    'How many cycles of the fade lattice fit across the frame it is measured on - the tiling unit, or the whole wall. Whole numbers only, which is what keeps it seamless.',
  taperKy: 'Cycles down the frame. Twice the across value gives a 45 degree diagonal.',
  taperSharp:
    'How hard the fade lattice is. At 0 the two wave families simply average into a soft quilt; at 100 lattice keeps the bands continuous where either peaks, chevron breaks them into separate diamonds, and blocks cuts a straight grid.',
  cullDriver:
    'What the removal gradient ramps along. THE PATTERN DRIVER is the original behaviour, which means a patterned design cannot also dissolve in its own direction - the driver is already making the pattern. THE FADE LAYER ramps along the fade field instead, so removal gets its own shape, direction, scale and seed while the pattern keeps the driver. The fade amount does not change the ramp depth; that stays with removed at start and holes removed.',
  taperScope:
    'What the fade is measured across. ONE TILING REPEAT matches the fade to the tiling - 1 panel under P1, the whole 2x2 block under P4 - so the run stays a repeating kit, at the cost of a straight ramp resetting at the end of each repeat. THE WHOLE WALL sweeps once across the run: smooth end to end, but every panel becomes a unique part.',
  taperDir:
    'Which way the fade runs - right, left, up, down, or any of the four diagonals.',
  taperWavelength:
    'How big the fade features are - the band spacing for wave, the cloud size for noise.',
  taperSeed:
    'Reshuffles the noise fade. The same seed gives the same clouds every time.',
  taperInvert:
    'Swaps which end the layer acts on - fade to the left instead of the right, or from the middle outward instead of from the corners in.',
  asaNoTriangle:
    'Breaks any ring of three dashes that would close a small triangle. The panel has none anywhere, and they appear on their own from the per-node choice, so they have to be removed afterwards.',
  asaDashFrac:
    'Dash length as a percentage of the small triangle edge it sits on. The reference runs 57 to 58 per cent, which leaves the rest as metal at the two ends and is what keeps dashes meeting at a node apart.',
  asaLayers:
    'How many of the three coarse lattices are drawn. Each is a triangular lattice of three times the side - nine small triangles - and the three of them divide every small edge between them, one owner each. Drawing fewer than three leaves whole families of edges empty.',
  asaKeep:
    'The chance an edge keeps its dash. This is the density control.',
  kitCols:
    'How many panels across the field repeats over, with the driver scope set to kit. Eight panels of a 4 x 2 kit tile any length of wall.',
  kitRows:
    'How many panels down the field repeats over.',
  lineGap:
    'Metal kept clear at both ends of every grid line, before any dash starts. This is what keeps the three lines meeting at a node from running into each other - the reservation is made first and the dash is cut to whatever span is left, so no combination of length and slide can eat into it. Raising it shortens every dash.',
  lineShift:
    'Slides one of the three line families along its own direction, as a percentage of the dash length - vertical under the hexV lattice. At 50% the ends of the three families meet instead of sitting mid-edge, which closes them into triangles. This one is allowed past the reserved end gap, so watch the clearance readout when you raise it.',
  lineStagger:
    'Slides the two diagonal families along their own lines, as a percentage of the edge. At 0 all three sit at their edge midpoints. Moving them puts the diagonals against the triangle centres while the verticals stay on the edges, so the two axes read as different things rather than as one uniform mesh.',
  linePairChance:
    'How often an edge carries a second dash of the same direction beside the first. Without it the closest same-direction neighbour is a whole lattice period away; the reference has one at 0.94 of a dash length, so some edges must be doubled.',
  linePairDist: 'How far the partner sits, as a percentage of the dash length. 94 is the measured value.',
  linePairAngle:
    'Which way the partner is offset, measured from the dash axis. 0 would put it end to end, 90 straight beside; 23 is the measured value, so it steps along and sideways at once.',
  lineFloat:
    'How far each dash may slide along its own line, as a percentage of the edge it sits on. 0 pins every dash to the midpoint, which reads as a rigid grid. Raising it keeps every dash ON the line - a straight edge still runs dash to dash - while removing the translational regularity, which is what a hand-stitched panel looks like.',
  lineSeed: 'Reshuffles the slides. Same seed, same panel.',
  stampCount:
    'How many holes each lattice node carries. 1 is the ordinary field. 3 turns every node into a group of three parallel holes, which is what makes a woven or stitched motif rather than a field of separate marks.',
  stampGap:
    'Centre-to-centre spacing inside a group, across the holes rather than along them. Raised automatically if it would leave less than the minimum web between two members - the group is never allowed to overlap itself.',
  shapeAngleSeed: 'Reshuffles which direction each node draws. Same seed, same pattern.',
  stampVary:
    'Chance that each hole beyond the first is actually there. 0 makes every group the full size; raising it mixes singles, pairs and triples, with singles most common. Around 35% matches a hand-stitched look.',
  radialShape:
    'What figure "distance from the centre" draws. 1 is a straight-sided DIAMOND, and below 1 its sides bow INWARD - the two points still meet at a corner, joined by a curve, which is the playing-card diamond. 2 is the circle this has always drawn, and higher values head toward a rectangle. Point it at the tiling unit rather than the panel and the figure is assembled out of four panels rather than repeated on each one.',
  shapeCurve:
    'How the two sides between the tips bend. 1 is straight - a plain rhombus. Below 1 they pinch inward and it reads as a playing-card diamond; above 1 they bow out, reaching an ellipse at 2. The two end points stay sharp at every setting. Bowing out costs hole size: at 2 the shape is a circle, which on a square grid has to be root 2 smaller than the rhombus to keep the same web.',
  curveMax:
    'Lets the gradient bend the sides as it crosses the field, running from the setting above to this one. 0 leaves the curve the same everywhere.',
  ratioMax:
    'Hands the driver the shape PROPORTION instead of the hole size. The ratio runs from the one above, at the low end of the field, to this at the high end. Set min dia = max dia alongside it and the gradient stops changing how big the holes are and changes what shape they are - a rhombus shearing from a square on its corner down to a sliver, its long diagonal never moving. 0 turns it off.',
  slotRatio:
    'How long a slot is against its width. The length is always the hole size; raising this narrows it. Around 6:1 and up it stops reading as a lozenge and starts reading as a dash or a stitch.',
  shapeAngleMode:
    'Which way each hole points. This is a RULE, not jitter - the angle comes from the lattice index or the position, so the same node always gets the same angle and the pattern still repeats on the module. ALL THE SAME is one angle everywhere. ALTERNATING flips 90 degrees on a checker. WOVEN steps through three angles 60 degrees apart, which is what turns slots into a hemp-leaf weave on a triangular lattice. RADIATING points each hole away from the nearest motif centre, giving rosettes; AROUND is the same field turned 90 degrees, giving rings.',
  shapeAngleDeg:
    'Rotates every hole on top of whatever the rule decided. On its own with ALL THE SAME, this is the single angle every slot points.',
  motifMm:
    'How far apart the centres the radiating rules point at. Snapped to a whole number of cells per panel, the same way pitch is, so the motif meets itself at the joint rather than drifting across the run.',
  latticeAspect:
    'Row spacing as a percentage of the column pitch. 100 is the lattice family default. Dropping it packs rows together so the field reads as columns of dots rather than an even scatter; raising it opens rows into stripes. The value is snapped to a whole even number of rows per panel, so a row still lands on the horizontal joint - the same guarantee pitch gives on the vertical one.',
  sizeContrast:
    'Spreads hole sizes across the full min..max range. A noise driver clusters its values in the middle, so at 0% most holes come out mid-sized and the field reads as soft mottling. Raising this pushes the distribution out to the ends, so small holes sit beside large ones - the difference between a gentle gradient and a field with real contrast.',
  crossKx:
    'How many pattern cycles fit across the 600mm panel width. A whole number keeps the diagonal continuing across every joint - which is why this counts cycles instead of taking a wavelength in mm, where almost every value breaks at the seam. Higher = finer diamonds.',
  crossKy:
    'How many cycles fit up the 1200mm panel height. Together with cycles-across this sets both the diamond size AND the diagonal angle: equal spacing in each direction gives 45 degrees, and unequal counts lean the lattice.',
  crossSharp:
    'How the two crossing wave families combine. At 100% the stronger of the two wins, giving crisp continuous bands with bright intersections - the argyle look. Lower blends them, so the bands soften and only their crossings stay bright.',
  modulation:
    'What drives hole size across the panel. Uniform: every hole the same. Linear: a straight ramp. RAMP: the one for a TRANSITION PANEL - it counts the lattice’s own rows instead of measuring millimetres, so the first row is exactly min dia, the last exactly max dia, and every row between is an equal step. Linear gets near the ends but lands on whatever each row position gives, and stumbles on one row whenever the span is not a whole number of rows - which shows at the joint on a panel whose whole job is to meet the standard panel beside it. Radial: grows from a centre point. Wave: one family of diagonal stripes. Lattice: two crossing families, giving a diamond grid of large holes. Chevron: the same two families multiplied, so only their crossings open up. Bands / noise / checker: stepped, organic and chequered variation.',
  modAngle: 'Direction the ramp runs. 0 = left to right, 90 = top to bottom.',
  sizeLevels:
    'Cuts the driver into steps before it sets the hole size, so a hole is one of a few sizes rather than anywhere on the ramp. Two gives a hard edge between big holes and small ones - a block instead of a fade. 1 leaves it continuous.',
  sizeSplit:
    'With two levels, how much of the field falls on the small side.',
  gamma:
    'Bends the ramp. 1 is a straight fade; below 1 pushes the change toward the start, above 1 toward the end.',
  zigHeight:
    'How far the band runs before it has risen and fallen once.',
  zigAmp:
    'How far the band wanders to either side of its diagonal. The band keeps advancing the same way whatever this is set to - it only rises and falls on the way - which is the difference between a wandering band and one that folds back.',
  wavelength:
    'Distance over which the wave or noise repeats. Below about twice the pitch the wave is finer than the holes sampling it, so it stops reading as a wave and starts beating against the lattice as a moire - useful on purpose, surprising by accident.',
  noiseDetail:
    'How many octaves of noise are stacked. 1 is soft featureless blobs; each extra octave adds finer structure at half the scale. An octave finer than twice the pitch has nothing to land on and just speckles, so past 2 or 3 the gain depends on how fine the lattice is.',
  noiseRough:
    'How much each finer octave contributes. Low keeps the field smooth and rounded; high lets the small octaves through, giving ragged edges and small satellites. Does nothing at detail 1 - there is only one octave to weigh.',
  noiseSnap:
    'Reads the noise at a snapped point, so the field is flat across each square and steps at the edges. That turns clouds into blocks that differ in size and position - which the regular blocks driver cannot do. 0 leaves the noise smooth.',
  noiseSnapAspect:
    'Shape of the snap cell, so the blocks can come out longer than they are wide. 100 is square.',
  blockAngle:
    'Only 0, 45 and 90 are offered: a turned block grid meets itself across the repeat at those angles and at no others, and one that does not draws a hard line wherever the pattern wraps. Turns the block grid. On a 45 degree dot screen the blocks want to sit square to the dots rather than to the panel.',
  noiseAspect:
    'Stretches the noise. 100 is round; ABOVE 100 stretches it vertically, BELOW 100 horizontally - the cell is divided across the axes, so raising the number makes the cell taller. Blob area is held roughly constant as it stretches, so the shape changes without the density changing with it.',
  noiseShear:
    'Skews the noise diagonally, in whole steps. Whole steps only because a fractional skew would not meet itself at the panel edge - the field has to stay periodic on its box.',
  waveShape:
    'The profile of one cycle. SINE and TRIANGLE grade hole size smoothly, so they read as a ripple - triangle holds a straighter ramp between the extremes. SAWTOOTH ramps up then drops in one step, giving a hard edge once per cycle. SQUARE uses only min and max dia, so it reads as hard stripes rather than a gradient.',
  steps: 'How many discrete bands the field is quantised into.',
  seed: 'Changes which holes the random-looking patterns pick. Same seed = same result, every time.',
  centerX: 'Horizontal position of the radial centre, across the field.',
  centerY: 'Vertical position of the radial centre, down the field.',
  invert: 'Swaps the ends of the driver - big holes become small and vice versa.',

  cull: 'Percentage of holes removed ENTIRELY, at full size. This is the cluster look, where circles drop out of an otherwise regular field. Leave at 0 and lower min dia instead if you want holes to shrink away rather than vanish.',
  cullMode:
    'Even: holes are removed uniformly across the whole field. Gradient: removal follows the driver, so the pattern dissolves from one side to the other.',
  cullFrom:
    'Where the gradient BEGINS, as a percentage removed. Holes removed runs from this value at one side of the panel to the main value at the other, so a single panel can join two densities - set it to the density of the neighbour it butts against. Only meaningful in gradient mode.',
  cullBand:
    'How much of the panel the change is spread over. 100% ramps edge to edge. 50% holds the start density over the first quarter, changes across the middle half, then holds the end density over the last quarter - so both halves of a transition panel still read as their neighbours.',
  cullFade:
    'Softens the edge of the void. Holes just short of being removed shrink toward nothing instead of stopping at full size, so the pattern dissolves rather than ending on a hard rim. 0 = a crisp boundary.',
  cullShape:
    'The SHAPE the removal takes. Scatter decides each hole on its own, so voids are single holes spread through the field - even or speckled, but never grouped. Clouds drives removal from a smooth noise field, so neighbouring holes vanish together and the gaps form soft organic clusters. Clouds is the one that reads like a vapour or dissolve. PATTERN ignores both and ranks the DRIVER itself, so the edge is geometric - holes stop exactly where the pattern does, rather than dithering out. That is what keeps a fine pitch sharp: under about 20mm pitch there are only a few millimetres between the smallest legal hole and the largest the web allows, so size can no longer carry the pattern, but removal can.',
  cullScale:
    'How big the clusters are, roughly, in mm. Small values give a fine mottle; large values give broad open drifts with dense areas between them.',
  cullAspect:
    'Stretches the clusters. 100% is round; below that they flatten into wide horizontal drifts, above that they draw out into tall vertical ones. Blob area is held roughly constant as you stretch, so the shape changes without the density changing with it.',
  cullShear:
    'Leans the clusters diagonally. Only whole steps are offered: a lean of a whole panel keeps the field seamless, whereas a free rotation of a tiling field would break the panel edges. 0 is upright.',
  cullRough:
    'How ragged the cluster edges are. Low gives smooth, cloud-like boundaries; high piles on finer detail so the blobs break up and shed satellite holes at their edges.',
  cullRandom:
    'How loose the removal is. With Scatter: 0% spreads removals as evenly as possible, 100% picks them at random. With Clouds: 0% gives clean cluster edges, and raising it roughens them by mixing per-hole noise back in - useful for breaking up an outline that looks too smooth.',
  tileBlendMm:
    'Width of the band along each panel edge that ALL FOUR tiles share. Inside that band every tile is identical, which is what lets them sit next to each other in any order; beyond it each tile follows its own pattern, so A/B/C/D are genuinely different panels. Narrow means the four differ more but reconcile abruptly at the joint; wide means safer and more alike. 0 removes the shared band entirely - tiles differ most, but their edges stop matching.',
  cullSeed:
    'Reshuffles WHICH holes disappear, without changing how many. Same seed always gives the same panel, so a design stays reproducible - step through a few to find an arrangement you like. This is separate from the modulation seed, which only affects the noise-based drivers.',

  modScope:
    'Locked: the ramp is anchored to a fixed span in mm, so adding a panel EXTENDS the pattern and existing holes keep their size. Run: the ramp always spans whatever is displayed, so adding a panel restretches everything. Use Locked for a run that grows on site.',
  spanMm: 'The fixed distance the ramp covers when the anchor is Locked.',

  panelColor: 'Colour of the panel face in the preview. Presentation only - it does not change geometry, but it is saved with the design and used by the SVG export.',
  holeColor: 'Colour of the perforations in the preview. Presentation only; carried into the SVG export.',
  showSeams: 'Draw a line on every panel joint. Drawn behind the holes, so it never hides the row of holes sitting on the seam.',
  showFrames: 'Outline each panel and label it.',
  showGhost: 'Show a faded preview of the next panel, to check the pattern continues.',
};

/** Delayed hover bubble. */
function wireTips() {
  const DELAY_MS = 500;
  let bubble = null;
  let timer = 0;

  const ensure = () => {
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.className = 'veil-tip';
      bubble.setAttribute('role', 'tooltip');
      document.body.appendChild(bubble);
    }
    return bubble;
  };

  const hide = () => {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    if (bubble) bubble.classList.remove('show');
  };

  const show = (host) => {
    const text = host.dataset.tip;
    if (!text) return;
    const b = ensure();
    b.textContent = text;
    b.classList.add('show');
    const r = host.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    // Prefer left of the rail; clamp into the viewport.
    let left = r.left - br.width - 12;
    if (left < 8) left = Math.min(r.left, window.innerWidth - br.width - 8);
    let top = r.top + r.height / 2 - br.height / 2;
    top = Math.max(8, Math.min(top, window.innerHeight - br.height - 8));
    b.style.left = left + 'px';
    b.style.top = top + 'px';
  };

  document.addEventListener('mouseover', (e) => {
    const host = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!host) return;
    hide();
    timer = setTimeout(() => show(host), DELAY_MS);
  });
  document.addEventListener('mouseout', (e) => {
    const host = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (host) hide();
  });
  document.addEventListener('mousedown', hide);
  window.addEventListener('scroll', hide, true);
}

/**
 * Pan + wheel-zoom over the canvas. Ported from spectRAL ui/canvas-pan.ts.
 *
 * Behaviour kept identical to spectRAL:
 *   - LEFT drag pans, with a grabbing cursor.
 *   - RIGHT drag also pans; the context menu is suppressed only when the
 *     pointer actually moved, so a plain right-click still opens it.
 *   - WHEEL / two-finger scroll drives the ZOOM slider - up zooms in - scaled
 *     by deltaY * 0.05 so a trackpad is smooth and a mouse notch steps ~5%.
 *   - Ctrl/Cmd + wheel is left to the browser.
 *   - A drag starting on a control (slider, button, the zoom pill) is ignored
 *     so the control keeps its native pointer capture.
 *
 * spectRAL pans a transform and clamps to BOUNDS_MARGIN. Here the stage is a
 * native scroll container, so panning is scrollLeft/scrollTop and the bounds
 * clamp comes free - which also keeps the scrollbars as the overflow hint,
 * standing in for spectRAL edge bars.
 */
function wirePanZoom() {
  const stage = document.getElementById('stage');
  if (!stage) return;

  const onControl = (t) => !!(t && t.closest && t.closest('input, button, label, select, #zoombar'));

  let dragging = false;
  let button = 0;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let scrollX0 = 0;
  let scrollY0 = 0;

  const begin = (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    if (e.defaultPrevented || onControl(e.target)) return;
    const canPan = stage.scrollWidth > stage.clientWidth || stage.scrollHeight > stage.clientHeight;
    if (!canPan) return;
    dragging = true;
    button = e.button;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    scrollX0 = stage.scrollLeft;
    scrollY0 = stage.scrollTop;
    stage.style.cursor = 'grabbing';
    if (e.button === 0) e.preventDefault(); // right-drag must not cancel contextmenu
  };

  stage.addEventListener('mousedown', begin);

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    stage.scrollLeft = scrollX0 - dx;
    stage.scrollTop = scrollY0 - dy;
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    stage.style.cursor = '';
  });

  // Capture phase: suppress the menu before anything else sees it, but only
  // when the right-drag actually panned.
  stage.addEventListener(
    'contextmenu',
    (e) => {
      if (button === 2 && moved) {
        e.preventDefault();
        e.stopPropagation();
      }
      button = 0;
      moved = false;
    },
    true
  );

  stage.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) return;
      const zoom = document.getElementById('zoomSlider');
      if (!zoom) return;
      e.preventDefault();
      const min = parseFloat(zoom.min || '25');
      const max = parseFloat(zoom.max || '400');
      const cur = parseFloat(zoom.value || '100');
      const next = Math.max(min, Math.min(max, cur - e.deltaY * 0.05));
      if (Math.round(next) === Math.round(cur)) return;
      zoom.value = String(Math.round(next));
      zoom.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { passive: false }
  );

  stage.style.cursor = 'grab';
}

/** Floating zoom pill over the canvas - mirrors spectRAL bottom-bar zoom. */
function wireZoom() {
  const slider = document.getElementById('zoomSlider');
  const out = document.getElementById('zoomVal');
  const fit = document.getElementById('zoomFit');
  if (!slider) return;
  slider.value = String(state.zoom);
  const apply = () => {
    state.zoom = Number(slider.value);
    if (out) out.textContent = state.zoom + '%';
    render();
  };
  slider.addEventListener('input', apply);
  fit?.addEventListener('click', () => {
    slider.value = '100';
    apply();
  });
  if (out) out.textContent = state.zoom + '%';
}

/**
 * Named save / load, in localStorage.
 *
 * Stores the whole control state under a name, so a look can be recovered
 * exactly - including the seeds, which is the only way a generated pattern is
 * reproducible. Geometry is NOT stored: it is rebuilt from the parameters, so a
 * saved design picks up any later engine fix rather than freezing old output.
 */
const STORE_KEY = 'veil.standard.saved.v1';
const DESIGNS_URL = 'designs.json';

// Where saves actually live. 'disk' means the harness is being served and the
// server persists designs.json next to the sources - the durable case. 'local'
// is the fallback when the page is opened straight off disk (file://), where
// there is no server to write to.
let storeMode = 'unknown';
let cache = {};

function localRead() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch {
    return {};
  }
}

function localWrite(all) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* quota or private mode - the disk copy is the real one anyway */
  }
}

/**
 * Load the library, preferring disk.
 *
 * localStorage is scoped to the browser PROFILE, and a preview pane often gets
 * a fresh profile - which silently lost every saved design between sessions.
 * Disk is the source of truth; localStorage is kept in step as a convenience
 * copy so file:// use still works.
 */
async function loadStore() {
  try {
    const r = await fetch(DESIGNS_URL, { cache: 'no-store' });
    if (r.ok) {
      cache = await r.json();
      storeMode = 'disk';
      // Merge anything that only exists locally, so a design saved before the
      // server endpoint existed is not stranded.
      const local = localRead();
      let merged = false;
      for (const [k, v] of Object.entries(local)) {
        if (!(k in cache)) {
          cache[k] = v;
          merged = true;
        }
      }
      if (merged) await persist();
      return cache;
    }
  } catch {
    /* not served, or no endpoint - fall through */
  }
  storeMode = 'local';
  cache = localRead();
  return cache;
}

async function persist() {
  localWrite(cache);
  if (storeMode !== 'disk') return true;
  try {
    const r = await fetch(DESIGNS_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cache, null, 2),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return true;
  } catch (err) {
    alert(
      'Saved in this browser only - writing designs.json failed: ' +
        (err && err.message ? err.message : 'unknown') +
        '\nUse Export to keep a copy.'
    );
    return false;
  }
}

function readStore() {
  return cache;
}

function refreshSavedList() {
  const sel = document.getElementById('savedList');
  if (!sel) return;
  const all = readStore();
  const names = Object.keys(all).sort();
  sel.textContent = '';
  sel.append(el('option', { value: '' }, names.length ? 'saved designs...' : 'nothing saved yet'));
  for (const nm of names) sel.append(el('option', { value: nm }, nm));
}

function wireSaveLoad() {
  const nameIn = document.getElementById('saveName');
  const sel = document.getElementById('savedList');
  if (!nameIn || !sel) return;

  nameIn.addEventListener('input', () => {
    state.designName = nameIn.value.trim();
  });

  document.getElementById('btnSave')?.addEventListener('click', async () => {
    const nm = (nameIn.value || '').trim();
    if (!nm) {
      nameIn.focus();
      return;
    }
    if (cache[nm] && !confirm('"' + nm + '" already exists. Overwrite it?')) return;
    state.designName = nm;
    cache[nm] = { ...state, savedAt: new Date().toISOString() };
    await persist();
    refreshSavedList();
    sel.value = nm;
  });

  sel.addEventListener('change', () => {
    const nm = sel.value;
    if (!nm) return;
    const saved = cache[nm];
    if (!saved) return;
    // Merge over DEFAULTS so a design saved before a control existed still
    // loads, picking up the new control's default instead of undefined.
    const { savedAt, ...params } = saved;
    void savedAt;
    Object.assign(state, { ...DEFAULTS, ...params });
    // A design saved before designName existed carries none, so take the key
    // it was stored under rather than leaving exports unnamed.
    state.designName = params.designName || nm;
    nameIn.value = state.designName;
    render();
  });

  document.getElementById('btnDelete')?.addEventListener('click', async () => {
    const nm = sel.value;
    if (!nm) return;
    if (!confirm('Delete "' + nm + '"?')) return;
    delete cache[nm];
    await persist();
    refreshSavedList();
  });

  // Portable backup: the whole library as one file, so it can be moved between
  // machines or kept alongside a project regardless of where it was saved.
  document.getElementById('btnExportAll')?.addEventListener('click', () => {
    download('veil-designs.json', JSON.stringify(cache, null, 2), 'application/json');
  });

  document.getElementById('btnImportAll')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const incoming = JSON.parse(await file.text());
      let added = 0;
      for (const [k, v] of Object.entries(incoming)) {
        // Never silently clobber: an imported name that already exists is
        // suffixed rather than overwriting local work.
        let key = k;
        let i = 2;
        while (key in cache && JSON.stringify(cache[key]) !== JSON.stringify(v)) {
          key = k + ' (' + i++ + ')';
        }
        if (!(key in cache)) added++;
        cache[key] = v;
      }
      await persist();
      refreshSavedList();
      alert('Imported ' + added + ' design(s).');
    } catch (err) {
      alert('Could not read that file: ' + (err && err.message ? err.message : 'invalid JSON'));
    } finally {
      e.target.value = '';
    }
  });

  loadStore().then(() => {
    refreshSavedList();
    const where = document.getElementById('storeWhere');
    if (where) {
      where.textContent = storeMode === 'disk' ? 'saved to designs.json' : 'saved in this browser only';
      where.className = storeMode === 'disk' ? 'storewhere ok' : 'storewhere warn';
    }
  });
}

function wireExports() {
  /**
   * Filename stem for every export.
   *
   * Uses the SAVED DESIGN NAME when there is one, so a DXF on someone's desk
   * can be traced back to the design that produced it. Falls back to a
   * descriptive stem built from the settings for an unsaved sketch, which is
   * better than a generic name but tells you nothing about intent.
   *
   * The live text field is read as well as the saved state, so typing a name
   * and exporting straight away works without having to press save first.
   */
  const stem = () => {
    const typed = document.getElementById('saveName');
    const raw = (typed && typed.value.trim()) || state.designName || '';
    const safe = raw
      // Anything a file system might object to becomes a hyphen.
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return safe || `veil-standard-${state.lattice}-${state.modulation}-${state.cols}x${state.rows}`;
  };
  // Every export goes through here so the result is always SAID. A click that
  // silently did nothing is what sent us looking for this in the first place.
  const saveTo = (name, text, mime) => {
    const stats = document.getElementById('stats');
    const note = (msg) => {
      if (geoInfo) {
        geoInfo.textContent = msg;
        geoInfo.title = msg;
      } else if (stats) stats.textContent = msg;
    };
    note('saving ' + name + '...');
    saveOut(name, text, mime)
      .then((path) => note(path ? 'saved -> ' + path : 'downloaded ' + name))
      .catch((e) => note('SAVE FAILED: ' + (e && e.message ? e.message : e)));
  };
  document.getElementById('x-svg').onclick = () =>
    saveTo(`${stem()}.svg`, toSVG(current), 'image/svg+xml');
  // PANEL GEOMETRY, HELD FOR THE SESSION ONLY.
  //
  // Not in `state`, which is what a saved design is made of: the same part
  // geometry applies to every design, so storing it there would copy the whole
  // DXF into all hundred-odd of them. It is a production input, not a recipe.
  let panelGeoDxf = null;
  let panelGeoName = '';
  const geoInfo = document.getElementById('geoInfo');
  const geoAlign = document.getElementById('geoAlign');
  const geoInput = document.getElementById('btnPanelGeo');
  const geoDrop = document.getElementById('geoDrop');
  const showGeo = (msg) => {
    if (!geoInfo) return;
    // Shown short so it can never shove the export buttons off the row; the
    // whole of it is on the tooltip.
    geoInfo.textContent = msg;
    geoInfo.title = msg;
  };
  const geoOpts = () => ({ dropOutside: geoDrop ? geoDrop.checked : true });
  const describeGeo = () => {
    if (!panelGeoDxf) return;
    let g;
    try {
      g = parsePanelGeo(panelGeoDxf, geoOpts());
    } catch {
      showGeo('unreadable dxf');
      return null;
    }
    if (!g.entities.length) {
      showGeo('no usable entities');
      return null;
    }
    const b = g.bbox;
    // Everything that did not make it, said out loud. R12 has no SPLINE, and a
    // profile that quietly went missing is worse than one that never loaded.
    const lost = Object.entries(g.skipped)
      .map(([k, n]) => k + ' x' + n)
      .join(', ');
    const stray = g.outside
      ? (geoDrop && geoDrop.checked ? '  DROPPED ' : '  KEPT ') +
        g.outside +
        ' outside declared extents'
      : '';
    showGeo(
      panelGeoName +
        ' - ' +
        g.entities.length +
        ' ents, ' +
        Math.round(b.maxX - b.minX) +
        ' x ' +
        Math.round(b.maxY - b.minY) +
        'mm, layers: ' +
        g.layers.join(' ') +
        (lost ? '  UNSUPPORTED: ' + lost : '') +
        stray
    );
    return g;
  };
  if (geoDrop) geoDrop.addEventListener('change', describeGeo);
  if (geoAlign) geoAlign.addEventListener('change', describeGeo);
  if (geoInput)
    geoInput.addEventListener('change', () => {
      const file = geoInput.files && geoInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        panelGeoDxf = String(reader.result);
        panelGeoName = file.name;
        if (!describeGeo()) panelGeoDxf = null;
        syncGeoBtn();
      };
      reader.readAsText(file);
    });
  // TWO BUTTONS, NOT ONE THAT CHANGES ITS MIND.
  //
  // A single button that folded the geometry in whenever a file happened to be
  // loaded would make the SAME click produce two different cut files depending
  // on state set minutes earlier. The plain export is what the pipeline has
  // always expected; the merged one is a deliberate, separately named act.
  const dxfMeta = () => ({
    panelGeo: {
      dxf: panelGeoDxf,
      align: geoAlign ? geoAlign.value : 'center',
      ...geoOpts(),
    },
  });
  const geoBtn = document.getElementById('x-dxf-geo');
  const syncGeoBtn = () => {
    if (geoBtn) geoBtn.disabled = !panelGeoDxf;
  };
  syncGeoBtn();
  document.getElementById('x-dxf').onclick = () =>
    saveTo(`${stem()}.dxf`, toDXF(current, {}), 'application/dxf');
  if (geoBtn)
    geoBtn.onclick = () => {
      if (!panelGeoDxf) return;
      saveTo(`${stem()}-geo.dxf`, toDXF(current, dxfMeta()), 'application/dxf');
    };
  document.getElementById('x-json').onclick = () =>
    saveTo(
      `${stem()}.payload.json`,
      JSON.stringify(toPayload(current, {}), null, 2),
      'application/json'
    );
  document.getElementById('x-rec').onclick = () =>
    saveTo(
      `${stem()}.recipe.json`,
      JSON.stringify(toRecipe(current, {}), null, 2),
      'application/json'
    );
}

render();
wireExports();
wireZoom();
wireSaveLoad();
wirePanZoom();
wireTips();
