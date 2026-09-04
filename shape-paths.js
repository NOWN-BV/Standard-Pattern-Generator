// prototypes/veil-standard-pattern/shape-paths.js
// Shape tessellation, ported verbatim from DXF_BUILDER.md section 4.3 so the
// SVG preview and the exported DXF are the same geometry - not two
// approximations of it.
//
// Vertices are returned in the spec's Y-UP convention. The SVG helper flips
// about the hole centre, because SVG is Y-down. Do not "fix" the vert lists
// to be Y-down: they must stay byte-comparable with the DXF contract.

export const TAU = Math.PI * 2;

/**
 * @param opts.ratio  slot length : width. 2.5 is the original fixed capsule.
 * @param opts.angle  rotation about the hole centre, radians, Y-up.
 *
 * Rotation lives HERE rather than in the renderer so the SVG preview and the
 * DXF polyline come from one vertex list - the whole reason this file exists.
 * A hole that looked rotated but exported straight would be worse than no
 * rotation at all.
 */
export function shapeVerts(type, cx, cy, r, opts = {}) {
  const verts = [];
  switch (type) {
    case 'hex':
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 - Math.PI / 6;
        verts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      break;
    case 'diamond':
      verts.push([cx, cy + r], [cx + r * 0.7, cy], [cx, cy - r], [cx - r * 0.7, cy]);
      break;
    // A RHOMBUS WHOSE PROPORTION IS FREE.
    //
    // 'diamond' is a rhombus too, but at one fixed proportion, and existing
    // designs depend on that number - so this is a separate shape rather than
    // a parameter added to it. Long diagonal 2r along the shape's own axis,
    // short diagonal 2r/ratio across it: at ratio 1 that is a square standing
    // on its corner, and as the ratio climbs it shears down to a sliver
    // without the long diagonal ever moving. That is the one property the
    // pattern this was built for holds constant.
    case 'rhomb': {
      const q = Math.max(1, opts.ratio ?? 1);
      const hw = r / q;
      const k = Math.max(0.2, opts.curve ?? 1);
      if (Math.abs(k - 1) < 1e-9) {
        verts.push([cx, cy + r], [cx + hw, cy], [cx, cy - r], [cx - hw, cy]);
        break;
      }
      // SIDES CURVED, TIPS STILL SHARP.
      //
      // The superellipse |x/hw|^k + |y/r|^k = 1, walked in the ANGLE rather
      // than in x, so all four extreme points land exactly on the axes at any
      // k: the two ends stay points and only the sides between them bend.
      // k = 1 is the straight rhombus above, below 1 the sides pinch inward -
      // a playing-card diamond - and above 1 they bow out, reaching an ellipse
      // at 2. A Bezier drawn tip to tip would round the tips off as it bulged,
      // which is the one thing that must not move.
      const e = 2 / k;
      const RHOMB_SEGS = 32; // divisible by 4, so the extremes are hit exactly
      for (let i = 0; i < RHOMB_SEGS; i++) {
        const th = (i * TAU) / RHOMB_SEGS;
        const ct = Math.cos(th);
        const st = Math.sin(th);
        verts.push([
          cx + hw * Math.sign(ct) * Math.abs(ct) ** e,
          cy + r * Math.sign(st) * Math.abs(st) ** e,
        ]);
      }
      break;
    }
    case 'square': {
      const s = r * 0.8;
      verts.push([cx - s, cy + s], [cx + s, cy + s], [cx + s, cy - s], [cx - s, cy - s]);
      break;
    }
    case 'cross': {
      const cw = r * 0.35;
      const cl = r;
      verts.push(
        [cx - cw, cy + cl],
        [cx + cw, cy + cl],
        [cx + cw, cy + cw],
        [cx + cl, cy + cw],
        [cx + cl, cy - cw],
        [cx + cw, cy - cw],
        [cx + cw, cy - cl],
        [cx - cw, cy - cl],
        [cx - cw, cy - cw],
        [cx - cl, cy - cw],
        [cx - cl, cy + cw],
        [cx - cw, cy + cw]
      );
      break;
    }
    case 'triangle':
      verts.push([cx, cy + r], [cx + r * 0.87, cy - r * 0.5], [cx - r * 0.87, cy - r * 0.5]);
      break;
    case 'star':
      for (let i = 0; i < 5; i++) {
        const ao = (i * TAU) / 5 - Math.PI / 2;
        const ai = ao + Math.PI / 5;
        verts.push([cx + r * Math.cos(ao), cy + r * Math.sin(ao)]);
        verts.push([cx + r * 0.4 * Math.cos(ai), cy + r * 0.4 * Math.sin(ai)]);
      }
      break;
    case 'slot': {
      // Length is always 2r; the ratio sets how narrow it gets. A dash rather
      // than a lozenge needs about 6:1 and up.
      const ratio = Math.max(1.05, opts.ratio ?? 2.5);
      const slw = r / ratio;
      const sll = r;
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI + (i * Math.PI) / 8;
        verts.push([cx + slw * Math.cos(a), cy - (sll - slw) + slw * Math.sin(a)]);
      }
      for (let i = 0; i <= 8; i++) {
        const a = (i * Math.PI) / 8;
        verts.push([cx + slw * Math.cos(a), cy + (sll - slw) + slw * Math.sin(a)]);
      }
      break;
    }
    case 'organic': {
      const seed = Math.abs(cx * 7.3 + cy * 13.1) % 100;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const rr = r * (0.65 + 0.35 * Math.sin(i * 2.7 + seed * 0.1));
        verts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
      }
      break;
    }
    default:
      break; // circle - emitted as a native primitive, no verts
  }
  const ang = opts.angle ?? 0;
  if (!ang || !verts.length) return verts;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  return verts.map(([vx, vy]) => {
    const dx = vx - cx;
    const dy = vy - cy;
    return [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca];
  });
}

const fx = (n) => Number(n.toFixed(3));

/**
 * SVG path `d` for one hole, in field coords (Y down).
 * Circles return null - render them as <circle> so the DOM stays light.
 */
export function svgPath(hole) {
  if (hole.type === 'circle') return null;
  const verts = shapeVerts(hole.type, hole.cx, hole.cy, hole.r, {
    angle: hole.angle,
    ratio: hole.ratio,
    curve: hole.curve,
  });
  if (!verts.length) return null;
  // Flip Y about the hole centre: spec verts are Y-up, SVG is Y-down.
  const d = verts
    .map(([vx, vy], i) => `${i ? 'L' : 'M'}${fx(vx)} ${fx(hole.cy - (vy - hole.cy))}`)
    .join(' ');
  return `${d} Z`;
}
