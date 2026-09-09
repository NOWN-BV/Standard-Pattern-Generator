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
// Shapes that can round off toward a circle. Not the slot or the rhombus:
// those are defined by a proportion rather than by corners, and they already
// have their own controls for it.
const MORPHABLE = new Set(['hex', 'diamond', 'square', 'triangle', 'star']);

/**
 * How far the polygon's own boundary is from its centre at this angle.
 * Ray-cast rather than assumed regular: 'square' has a circumradius of 1.131r
 * and 'diamond' is a rhombus, so a formula for a regular n-gon would misplace
 * both of them. Used only by the fallback for shapes that are not convex.
 */
function polyRadiusAt(verts, cx, cy, ang) {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  let best = 0;
  for (let i = 0; i < verts.length; i++) {
    const [ax, ay] = verts[i];
    const [bx, by] = verts[(i + 1) % verts.length];
    const ex = bx - ax;
    const ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - cx) * ey - (ay - cy) * ex) / den;
    const u = ((ax - cx) * dy - (ay - cy) * dx) / den;
    if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && t > best) best = t;
  }
  return best;
}

const ARC_SEGS = 16; // segments per corner arc

/** Signed area; positive when the ring runs counter-clockwise. */
function signedArea(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** True when every turn goes the same way. */
function isConvex(v) {
  let sign = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    const c = v[(i + 2) % v.length];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-12) continue;
    const s = z > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * A FILLET OF ONE RADIUS, WHICH IS WHAT A FILLET IS.
 *
 * Every corner gets the SAME arc radius, the way it works in CAD. That matters
 * for more than tidiness: give each corner its own radius, sized to the edges
 * meeting there, and a rhombus rounds off into an OVAL instead of a circle,
 * because its sharp corners and its blunt corners reach their limits at the
 * same moment. One radius everywhere is instead exactly a morphological
 * opening - shrink the shape by d, grow it back by d - and an opening of any
 * convex shape converges on its INSCRIBED CIRCLE as d reaches the inradius.
 * So the corners round, the edges stay straight, and it still ends at a circle.
 *
 * Built directly rather than by offsetting: shrink the edge lines inward by d
 * and intersect them, then walk that inner ring, emitting an arc of radius d
 * around each of its corners and each of its edges pushed back out by d.
 */
function openConvex(base, d) {
  const n = base.length;
  const ccw = signedArea(base) > 0;
  const nx = [];
  const ny = [];
  const off = []; // outward normal, and the shrunk line's offset along it
  for (let i = 0; i < n; i++) {
    const P = base[i];
    const Q = base[(i + 1) % n];
    let ex = Q[0] - P[0];
    let ey = Q[1] - P[1];
    const L = Math.hypot(ex, ey);
    if (L < 1e-12) return null;
    ex /= L;
    ey /= L;
    // outward is to the right of travel on a counter-clockwise ring
    const ox = ccw ? ey : -ey;
    const oy = ccw ? -ex : ex;
    nx.push(ox);
    ny.push(oy);
    off.push(ox * P[0] + oy * P[1] - d);
  }
  // corners of the shrunk ring: where consecutive shrunk lines cross
  const inner = [];
  for (let i = 0; i < n; i++) {
    const j = (i + n - 1) % n;
    const det = nx[j] * ny[i] - ny[j] * nx[i];
    if (Math.abs(det) < 1e-9) return null; // parallel edges never cross
    inner.push([
      (off[j] * ny[i] - ny[j] * off[i]) / det,
      (nx[j] * off[i] - off[j] * nx[i]) / det,
    ]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const V = inner[i]; // the corner between edge i-1 and edge i
    const j = (i + n - 1) % n;
    const a1 = Math.atan2(ny[j], nx[j]);
    const a2 = Math.atan2(ny[i], nx[i]);
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= TAU;
    while (sweep < -Math.PI) sweep += TAU;
    // from k=1: the arc opens on the point the previous edge closed on, and a
    // repeated point is a zero-length segment that every downstream consumer -
    // the area sum, the clearance test, the DXF polyline - then has to cope with.
    for (let k = 1; k <= ARC_SEGS; k++) {
      const a = a1 + (sweep * k) / ARC_SEGS;
      out.push([V[0] + d * Math.cos(a), V[1] + d * Math.sin(a)]);
    }
    // the straight run of edge i, pushed back out by d
    const W = inner[(i + 1) % n];
    out.push([W[0] + d * nx[i], W[1] + d * ny[i]]);
  }
  return out;
}

/** Distance from the centre to the nearest edge line - how far d can go. */
function inradius(base, cx, cy) {
  let m = Infinity;
  for (let i = 0; i < base.length; i++) {
    const P = base[i];
    const Q = base[(i + 1) % base.length];
    const ex = Q[0] - P[0];
    const ey = Q[1] - P[1];
    const L = Math.hypot(ex, ey);
    if (L < 1e-12) continue;
    m = Math.min(m, Math.abs((cx - P[0]) * ey - (cy - P[1]) * ex) / L);
  }
  return Number.isFinite(m) ? m : 0;
}

/** Largest distance from the centre out to the outline. */
function outlineExtent(v, cx, cy) {
  let m = 0;
  for (const p of v) m = Math.max(m, Math.hypot(p[0] - cx, p[1] - cy));
  return m;
}

/**
 * ROUNDED OFF TOWARD A CIRCLE, BY FILLETING THE CORNERS.
 *
 * morph 1 is the polygon exactly as drawn. Below it the corners carry a fillet,
 * one radius for all of them, and at 0 the fillets have swallowed the edges and
 * the shape is a circle. Note what this is NOT: pulling the boundary in toward
 * a circle leaves a KINK at every corner, because the corner is still a corner,
 * only a shallower one. A fillet replaces it with an arc running tangent to
 * both edges, so what a small hole loses is its points, not its flats.
 *
 * Filleting on its own ends at the inscribed circle, narrower than the diameter
 * the hole is specified at, so the result is scaled back out - by nothing at
 * morph 1, and at morph 0 by just enough that the circle is the hole's own
 * radius. The widest point therefore runs smoothly from the shape's own out to
 * r, and never exceeds what the unrounded shape already occupied.
 *
 * A shape that is not convex - the star - cannot become a circle by filleting
 * at all, since its notches only sharpen as its points round away. It is
 * filleted as far as its corners allow and then drawn the rest of the way in,
 * so that it still arrives at a circle. That last part is a blend, not a fillet.
 */
function morphVerts(base, cx, cy, r, morph) {
  const m = Math.max(0, Math.min(1, morph));
  const b = 1 - m; // how much fillet
  const cen = base.map(([x, y]) => [x - cx, y - cy]);
  let v = null;
  if (b > 0 && isConvex(cen)) v = openConvex(cen, b * inradius(cen, 0, 0));
  if (!v) {
    // not convex: pull the boundary in toward the circle instead
    v = [];
    const SEG = 64;
    for (let i = 0; i < SEG; i++) {
      const a = (i * TAU) / SEG;
      const rp = polyRadiusAt(cen, 0, 0, a) || r;
      const rr = r + (rp - r) * m;
      v.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
  }
  // At the full fillet the inner ring has collapsed to a point and every
  // straight run has gone to nothing. The outline is right, but it carries
  // repeated points; drop them so what leaves here is a clean ring.
  v = v.filter((q, i) => {
    const w = v[(i + 1) % v.length];
    return Math.hypot(q[0] - w[0], q[1] - w[1]) > 1e-9;
  });
  const ext = outlineExtent(v, 0, 0);
  if (ext <= 1e-9) return v.map(([x, y]) => [cx + x, cy + y]);
  const want = r + (outlineExtent(cen, 0, 0) - r) * m;
  const s = want / ext;
  return v.map(([x, y]) => [cx + x * s, cy + y * s]);
}

export function shapeVerts(type, cx, cy, r, opts = {}) {
  let verts = [];
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
  // Rounding happens before rotation, so the two compose.
  const morph = opts.morph;
  if (morph !== undefined && morph < 1 - 1e-9 && MORPHABLE.has(type) && verts.length) {
    verts = morphVerts(verts, cx, cy, r, morph);
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
    morph: hole.morph,
  });
  if (!verts.length) return null;
  // Flip Y about the hole centre: spec verts are Y-up, SVG is Y-down.
  const d = verts
    .map(([vx, vy], i) => `${i ? 'L' : 'M'}${fx(vx)} ${fx(hole.cy - (vy - hole.cy))}`)
    .join(' ');
  return `${d} Z`;
}
