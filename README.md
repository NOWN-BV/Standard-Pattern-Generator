# VEIL standard pattern generator (prototype)

Parametric perforation patterns for the Arktura-standard product line —
adjust live, then export. Sibling to the image-driven SPECTRAL engine in
`src/client/pattern/`, not a replacement for it.

Default configuration is a **4-panel run** (`cols: 4, rows: 1`) on a single
continuous lattice.

## Why this is separate from SPECTRAL

|                     | SPECTRAL (`src/client/pattern/generate.ts`) | Standard pattern (this folder)             |
| ------------------- | ------------------------------------------- | ------------------------------------------ |
| Hole size driven by | sampled image luminance                     | a parametric recipe (lattice + modulation) |
| Input               | uploaded raster                             | numbers only                               |
| Reproducible from   | image + params                              | params alone (`recipe.json`)               |
| Output contract     | `veil.spectral.v1`                          | `veil.spectral.v1` (identical)             |

Because the payload is identical, the existing Fastify output registry
generates DXF / PDF / PNG for a standard pattern with **no backend change**.

## Continuity — the part that matters

The lattice is generated in field coordinates from integer indices anchored at
the field origin, never from the left edge of the visible run. Panel seams
only decide where the sheet is cut.

Combined with `modScope: 'locked'` (the default), adding a 5th panel extends
the run and every already-placed hole keeps its exact position and diameter.
`smoke.mjs` asserts this bit-for-bit. Switch to `modScope: 'run'` and the
gradient restretches to the new run length instead — correct for a fixed wall,
wrong for a run that grows on site.

The preview shows a ghosted "continues" panel past the end of the run so the
seam behaviour is visible while you tune.

## Fabrication rules enforced in the core

All from `src/shared/constants/panels.ts` — the same numbers the production
engine uses:

- 596 × 1196 mm perforated face on a 600 × 1200 mm module
- `MIN_GAP` 3 mm minimum land — caps hole diameter against pitch
- `MIN_HOLE_DIA` 9 mm / `MAX_HOLE_DIA` 75 mm clamp
- `MIN_PERF_AREA` 63.6 mm² per-hole floor — thin shapes (slot, cross,
  triangle) need a much larger extent than a circle to clear it
- `BEND_SNAP_CLEAR` 15 mm edge keep-out, so nothing lands in a fold radius.
  Holes that violate it are shrunk to fit, dropped, or allowed through —
  your choice, per `seamRule`.

The footer reports holes, open area %, diameter range, shrunk count and
dropped count, so every rule that fired is visible rather than silent.

## The size a design states is the size it cuts

`sizeContrast` re-ranks hole sizes onto a uniform rank. Ties have to share a
rank - two holes sampling the same point must get the same verdict or opposite
panel edges stop matching - but ranking each tie group by its FIRST index over
n can never reach 1: the last group starts at n minus its own size. So with
contrast at 100 the largest holes always fell short. `Basic-50-1225` asked for
25mm and cut 24.55; 43 of the saved designs were affected. Dividing by where
the last group starts fixes it, ties intact.

`stats.diaLow` / `diaHigh` / `diaShort` now report what was actually cut
against what was asked for, and the preview says so in the warning bar. A ramp
whose span is longer than the panel, a driver that never reaches its own
extreme, a pitch that refuses the diameter - all of them show up there instead
of in a DXF.

## Transition panels

A transition panel is specified by its ENDS: it butts against a standard panel
of one hole size at one edge and another size at the other, and if its end row
is not exactly that size the joint shows.

Set **ramp** as the driver, min dia to one end and max dia to the other, and
`modAngle` for the direction (90 top to bottom, 270 the other way, 0 across).
Ramp counts the lattice own rows rather than measuring millimetres, so the
first row is exactly min dia and the last exactly max dia whatever the span -
a linear ramp gets near the ends but stumbles on one row whenever the span is
not a whole number of rows.

It runs along either axis - `modAngle` 90 top to bottom, 270 the other way,
0 left to right, 180 right to left - on every lattice. A staggered lattice
offsets alternate rows by half a pitch, so along that axis the ramp steps every
half pitch rather than every cell; counting whole cells there put two identical
columns at each step.

**Turn the corner** joins a run grading left to right to one grading top to
bottom. A straight ramp cannot: across makes every column one size, down makes
every row one size, so the two present different edges and will not butt. A
diagonal does not help either - its edges vary too. Taking the larger of the
two counts does: along the top edge the down term is zero so it IS the across
ramp, along the left edge the across term is zero so it IS the down ramp. So an
across panel sits above the corner and a down panel beside it. `modAngle` picks
which corner holds the fine end - 45 top-left, 135 top-right, 225 bottom-right,
315 bottom-left.

A ramp follows an AXIS; angles between snap to the nearer one. A diagonal ramp
was built and removed: measured against `linear` at the same angle it was
identical to the millimetre whenever the span is a whole number of rows - which
it is by default - and all four of its edges vary, so it matched no edge of any
panel in the set (across, down, corner, uniform: 0 of 20 combinations). A panel
that joins nothing is not a panel. Use `linear` for a gradient at an arbitrary
angle.

Saved: `Transition 12.5-25`, its `flip`, and `across`. All on hex pitch 50, the
same lattice as `Basic-50-12` / `Basic-50-25`, so the ends match those panels
hole for hole - which `smoke.mjs` asserts rather than assumes.

A ramp is never wrapped on the tiling. Every other driver is a pattern, and
a pattern under P1/P4 has to meet itself at the joint - which is what wrapping
the sample enforces. A ramp is a transition: it runs from one diameter to
another and never butts against a copy of itself, so the tiling setting does
not apply to it. Wrapping it used to put the first row of small holes along
the bottom edge, which is the exact seam this mode exists to remove.

If the pitch cannot carry the diameter asked for, the holes are cut smaller -
a negative web is not an option - and the preview says so in the warning bar.
It is not left to be noticed.

## Panel geometry in the DXF

`DXF_BUILDER.md` always said the cut and bend layers "live in the separate
panel-geometry DXFs and are merged by a later stage". The **panel geo** button
next to the export buttons is that stage: pick a flat-pattern DXF of the real
part and it is laid under the perforation on every panel, so one file carries
both instead of a 600x1200 rectangle standing in for a panel that actually has
returns and notches.

- Source layer names are kept (`OUTER_PROFILES`, `BEND`, whatever the part was
  drawn with) and declared in the output, not collapsed onto layer `0`.
- Output stays R12, so `LWPOLYLINE` is folded into `POLYLINE` and bulges ride
  along on the vertex. What R12 cannot hold - `SPLINE`, `ELLIPSE`, `INSERT`,
  `HATCH` - is **counted and shown next to the file name**, never dropped
  silently: a cut file quietly missing a profile is scrap metal.
- Alignment picks where the file own origin lands in the panel box: as drawn
  (for a file prepared on the module frame), bbox to corner, or centred.
- An arc counts for the part it SWEEPS, not for its whole circle. One shallow
  arc of a large radius otherwise puts the bounding box a hundred metres wide
  and throws every centred alignment off.
- A 2D entity is drawn in its own plane, and codes 210/220/230 say which way
  that plane faces. CAD writes `(0,0,-1)` for anything on a mirrored plane and
  its x is then measured the other way; mirroring an arc also reverses its
  sweep. Planes at some arbitrary angle are reported, not guessed at.
- Exports are written by the harness server into `exports/` rather than handed
  to the browser, which on this machine discarded the filename and saved a
  GUID `.tmp`. Without a server it falls back to a normal download.
- Geometry lying wholly outside the file own `$EXTMIN` / `$EXTMAX` is treated
  as stray - a mirrored construction copy left in model space is the usual
  cause - and dropped by default, with the count shown. Untick **drop stray**
  to keep it.

On `Base Geo.dxf` that reads 704.50 x 1269.50mm with the inner bend lines
596.00 x 1196.00 apart, which is the perforated face exactly, so **centred** is
the alignment that file wants.
- Held for the session only. The same part applies to every design, so storing
  it in a design would copy the DXF into all hundred-odd of them - it is a
  production input, not part of the pattern recipe.

## Files

| File                                  | Lines | Role                                                         |
| ------------------------------------- | ----- | ------------------------------------------------------------ |
| `pattern-core.js`                     | 360   | lattice families, modulation drivers, fabrication clamps     |
| `shape-paths.js`                      | 102   | shape tessellation, ported from `DXF_BUILDER.md` §4.3        |
| `presets.js`                          | 156   | named standard recipes — **placeholder names, see below**    |
| `exporters.js`                        | 405   | SVG, R12 DXF, `veil.spectral.v1` payload, recipe JSON        |
| `PatternControls.jsx`                 | 366   | control rail                                                 |
| `VeilStandardPatternGenerator.jsx`    | 369   | preview, stats, export bar                                   |
| `main.jsx` / `index.html`             | 28    | standalone React entry point                                 |
| `smoke.mjs`                           | 140   | node smoke test — continuity + fabricability invariants      |
| `preview-ui.js` + `build-preview.mjs` | 467   | no-install harness: bundles the real core into a single HTML |
| `sketch.mjs`                          | 146   | renders the review SVGs in `samples/`                        |

All under the 600-line cap in `CLAUDE.md`. `preview.html` and `samples/*.svg`
are generated — they are in `.prettierignore`; regenerate, don't edit.

## Run it

```bash
node prototypes/veil-standard-pattern/smoke.mjs
```

The geometry core and all three writers are pure JS with no React or DOM
dependency, so the smoke test needs nothing installed.

To click around without installing anything, build the harness and open the
file it writes:

```bash
node prototypes/veil-standard-pattern/build-preview.mjs
```

It inlines the actual `pattern-core` / `shape-paths` / `presets` / `exporters`
sources into `preview.html`, so the harness cannot drift from the engine.
Same controls, same exports, vanilla JS instead of React.

```bash
node prototypes/veil-standard-pattern/sketch.mjs
```

writes `samples/run-continuity.svg` (the 4-panel run plus the 5th panel
continuing it) and `samples/preset-strip.svg` (one module per recipe).

For the UI, this repo does not currently depend on React — adding it to the
root `package.json` is an architecture decision, so it is **not** done here.
Two options:

1. **Isolated dev server** (nothing touches the root manifest):

   ```bash
   cd prototypes/veil-standard-pattern && npm i -D vite @vitejs/plugin-react react react-dom && npx vite
   ```

2. **Port to the app's vanilla-TS idiom** — the JSX is deliberately thin: all
   geometry lives in `pattern-core.js`, so only the two `.jsx` files need
   rewriting as TS render functions to drop it into `src/client/`.

## Before this ships

- **Preset names are placeholders.** `docs/design-handoff/BEHAVIOR.md`
  ("Source-of-truth data — DO NOT INVENT") forbids invented product codes.
  Replace every `id` / `name` in `presets.js` with the real Arktura
  standard-pattern names from the PIM, and check each recipe's pitch and
  diameter ladder against the published open-area figures.
- **Client-side DXF is prototype-only.** Production DXF generation belongs to
  the server (`CLAUDE.md`, "Architecture context"). When integrating, keep the
  SVG preview, drop `toDXF`, and POST `toPayload()` to the output registry.
- Add the `veil.standard-pattern.v1` recipe schema to `src/shared/schema/` if
  saved standard designs need to round-trip through Supabase.
