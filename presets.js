// prototypes/veil-standard-pattern/presets.js
//
// NAMING WARNING - these are DESCRIPTIVE working names, not catalog SKUs.
// docs/design-handoff/BEHAVIOR.md ("Source-of-truth data - DO NOT INVENT")
// forbids inventing product codes. Before this ships, replace `name` / `id`
// with the real Arktura standard-pattern names + codes from the PIM, and
// confirm each recipe's pitch / diameter ladder against the published
// open-area figures. The geometry engine is correct; the labels are
// placeholders.

export const PRESETS = [
  {
    id: 'ALIGNED-FINE',
    name: 'Aligned - fine',
    note: 'Square lattice, one hole size. The baseline standard perf.',
    params: {
      lattice: 'grid',
      pitch: 24,
      shape: 'circle',
      minDia: 12,
      maxDia: 12,
      modulation: 'uniform',
    },
  },
  {
    id: 'ALIGNED-OPEN',
    name: 'Aligned - open',
    note: 'Same lattice, larger hole. Higher open area, more acoustic bite.',
    params: {
      lattice: 'grid',
      pitch: 34,
      shape: 'circle',
      minDia: 22,
      maxDia: 22,
      modulation: 'uniform',
    },
  },
  {
    id: 'STAGGER-UNIFORM',
    name: 'Staggered - uniform',
    note: 'Half-pitch row offset. Reads denser than aligned at equal open area.',
    params: {
      lattice: 'stagger',
      pitch: 30,
      shape: 'circle',
      minDia: 16,
      maxDia: 16,
      modulation: 'uniform',
    },
  },
  {
    id: 'HEX-UNIFORM',
    name: 'Hex - uniform',
    note: '60 degree triangular lattice - the tightest regular packing.',
    params: {
      lattice: 'hex',
      pitch: 28,
      shape: 'circle',
      minDia: 15,
      maxDia: 15,
      modulation: 'uniform',
    },
  },
  {
    id: 'GRADIENT-V',
    name: 'Gradient - vertical',
    note: 'Size ramp top to bottom. Continuous across the whole run.',
    params: {
      lattice: 'stagger',
      pitch: 34,
      shape: 'circle',
      minDia: 10,
      maxDia: 28,
      modulation: 'linear',
      modAngle: 90,
      gamma: 1,
    },
  },
  {
    id: 'GRADIENT-H',
    name: 'Gradient - horizontal',
    note: 'Size ramp across the run - the clearest demo of panel continuity.',
    params: {
      lattice: 'stagger',
      pitch: 34,
      shape: 'circle',
      minDia: 10,
      maxDia: 28,
      modulation: 'linear',
      modAngle: 0,
      gamma: 1,
    },
  },
  {
    id: 'BANDS-5',
    name: 'Banded - 5 step',
    note: 'Quantised ramp. Five discrete diameters, no visual dithering.',
    params: {
      lattice: 'grid',
      pitch: 32,
      shape: 'circle',
      minDia: 10,
      maxDia: 26,
      modulation: 'bands',
      modAngle: 0,
      steps: 5,
    },
  },
  {
    id: 'WAVE',
    name: 'Wave',
    note: 'Sinusoidal size modulation. Wavelength set in mm, so it repeats predictably.',
    params: {
      lattice: 'stagger',
      pitch: 32,
      shape: 'circle',
      minDia: 10,
      maxDia: 26,
      modulation: 'wave',
      modAngle: 0,
      wavelength: 1200,
    },
  },
  {
    id: 'DIAGONAL-45',
    name: 'Diagonal 45',
    note: 'Lattice rotated 45 degrees about the field centre.',
    params: {
      lattice: 'diagonal',
      latticeAngle: 45,
      pitch: 32,
      shape: 'square',
      minDia: 16,
      maxDia: 16,
      modulation: 'uniform',
    },
  },
  {
    id: 'ORGANIC-DRIFT',
    name: 'Organic drift',
    note: 'Seeded noise size field + position jitter. Deterministic per seed.',
    params: {
      lattice: 'stagger',
      pitch: 34,
      shape: 'circle',
      minDia: 10,
      maxDia: 28,
      modulation: 'noise',
      wavelength: 1400,
      jitter: 18,
      seed: 7,
    },
  },
];

export const findPreset = (id) => PRESETS.find((p) => p.id === id) || null;
