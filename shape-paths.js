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

// A CORNER IS AN ARC, AND IT LEAVES HERE AS ONE.
//
// A fillet used to be written out as sixteen little straight segments, which
// is both wrong and enormous: a 279-hole panel of filleted hexagons came to
// 2310 KB of DXF against 168 KB for the same panel with sharp corners, because
// every hole carried 102 vertices instead of 6. As an ARC it is two vertices -
// the two tangent points - and a bulge, which is what DXF has had since R12 and
// what the parser in exporters.js already reads on the way in.
//
// So a vertex here is [x, y] or [x, y, bulge], where the bulge is tan of a
// quarter of the sweep of the arc running from THIS vertex to the next, signed
// counter-clockwise. Anything that needs a plain polygon calls flattenBulges().
const ARC_TOL = 0.02; // mm of chord error allowed when an arc must be flattened

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
    let sweep = Math.atan2(ny[i], nx[i]) - Math.atan2(ny[j], nx[j]);
    while (sweep > Math.PI) sweep -= TAU;
    while (sweep < -Math.PI) sweep += TAU;
    // Two tangent points and a bulge. The straight run to the next corner falls
    // out of it: the arc closes on edge i offset by d, and the next arc opens on
    // the same edge offset by the same d, so the segment between them is the
    // edge itself and carries no bulge.
    out.push([V[0] + d * nx[j], V[1] + d * ny[j], Math.tan(sweep / 4)]);
    out.push([V[0] + d * nx[i], V[1] + d * ny[i]]);
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

/**
 * Largest distance from the centre out to the outline, ARCS INCLUDED.
 *
 * Once a fillet is carried as a bulge the vertex list holds only the tangent
 * points, and the arc between them bows out past both. Measuring the points
 * alone put a 35mm hexagon at 35.34 and every filleted hole came out over the
 * diameter it was specified at. For each arc the farthest point of its full
 * circle is |OC| + R along the ray from the shape centre through the arc
 * centre; it counts only when that direction falls inside the sweep, and
 * otherwise the endpoints already do.
 */
function outlineExtent(v, cx, cy) {
  let m = 0;
  for (let i = 0; i < v.length; i++) {
    const p1 = v[i];
    m = Math.max(m, Math.hypot(p1[0] - cx, p1[1] - cy));
    if (!(p1.length > 2 && p1[2])) continue;
    const p2 = v[(i + 1) % v.length];
    const arc = arcFromBulge(p1, p2, p1[2]);
    if (!arc) continue;
    const far = Math.atan2(arc.cy - cy, arc.cx - cx);
    let d1 = far - arc.a1;
    const tau = Math.PI * 2;
    while (d1 < 0) d1 += tau;
    while (d1 >= tau) d1 -= tau;
    const within = arc.sweep > 0 ? d1 <= arc.sweep : d1 - tau >= arc.sweep;
    if (within) m = Math.max(m, Math.hypot(arc.cx - cx, arc.cy - cy) + arc.r);
  }
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
  // repeated points; drop them so what leaves here is a clean ring. The FIRST
  // of a coincident pair goes, never the second: the pair is an arc's end and
  // the next arc's start, and it is the second that carries the bulge.
  v = v.filter((q, i) => {
    const w = v[(i + 1) % v.length];
    return Math.hypot(q[0] - w[0], q[1] - w[1]) > 1e-9;
  });
  const ext = outlineExtent(v, 0, 0);
  if (ext <= 1e-9) return v.map(([x, y]) => [cx + x, cy + y]);
  const want = r + (outlineExtent(cen, 0, 0) - r) * m;
  const s = want / ext;
  // A bulge is a ratio, so it survives scaling untouched.
  return v.map(([x, y, b]) => (b ? [cx + x * s, cy + y * s, b] : [cx + x * s, cy + y * s]));
}

/**
 * The arc a bulge describes: centre, radius and the two end angles.
 * b = tan(sweep / 4), signed counter-clockwise, per the DXF convention.
 */
export function arcFromBulge(p1, p2, b) {
  const sweep = 4 * Math.atan(b);
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-12 || Math.abs(sweep) < 1e-12) return null;
  const rad = chord / (2 * Math.sin(Math.abs(sweep) / 2));
  // centre is off the chord midpoint, on the side the sweep turns toward
  const h = Math.sqrt(Math.max(0, rad * rad - (chord / 2) * (chord / 2)));
  const sgn = sweep > 0 ? 1 : -1;
  const inside = Math.abs(sweep) > Math.PI ? -1 : 1;
  const mx = (p1[0] + p2[0]) / 2;
  const my = (p1[1] + p2[1]) / 2;
  const cx = mx - (sgn * inside * h * dy) / chord;
  const cy = my + (sgn * inside * h * dx) / chord;
  return {
    cx,
    cy,
    r: rad,
    a1: Math.atan2(p1[1] - cy, p1[0] - cx),
    a2: Math.atan2(p2[1] - cy, p2[0] - cx),
    sweep,
  };
}

/**
 * A plain polygon from a ring that may carry bulges, for anything that has to
 * treat the outline as a list of points - an area sum, a hit test, a raster.
 * Segment count follows the arc rather than being fixed, so a 1.5mm fillet
 * costs three segments and a fully rounded hole stays round.
 */
export function flattenBulges(verts, tol = ARC_TOL) {
  if (!verts.some((v) => v.length > 2 && v[2])) return verts;
  const out = [];
  for (let i = 0; i < verts.length; i++) {
    const p1 = verts[i];
    const p2 = verts[(i + 1) % verts.length];
    out.push([p1[0], p1[1]]);
    const arc = p1.length > 2 && p1[2] ? arcFromBulge(p1, p2, p1[2]) : null;
    if (!arc) continue;
    // chord error of one segment is R(1 - cos(step/2)); solve for step
    const step = arc.r > tol ? 2 * Math.acos(1 - tol / arc.r) : Math.PI;
    const segs = Math.max(3, Math.ceil(Math.abs(arc.sweep) / step));
    for (let k = 1; k < segs; k++) {
      const a = arc.a1 + (arc.sweep * k) / segs;
      out.push([arc.cx + arc.r * Math.cos(a), arc.cy + arc.r * Math.sin(a)]);
    }
  }
  return out;
}

/**
 * Area enclosed by a ring that may carry bulges - EXACTLY, not to a tolerance.
 *
 * Shoelace over the chords, plus the circular segment each arc adds beyond its
 * own chord: (R squared / 2)(theta - sin theta), signed by the way the arc
 * turns. Flattening and summing instead makes the answer depend on how finely
 * it was flattened, and the area here is normalised to a unit radius, where a
 * tolerance quoted in millimetres is 2 % of the whole shape - which is exactly
 * how a fully rounded hole came to report 3.078 against pi.
 */
export function ringArea(verts) {
  let s2 = 0;
  let seg = 0;
  for (let i = 0; i < verts.length; i++) {
    const p1 = verts[i];
    const p2 = verts[(i + 1) % verts.length];
    s2 += p1[0] * p2[1] - p2[0] * p1[1];
    const b = p1.length > 2 ? p1[2] : 0;
    if (!b) continue;
    const arc = arcFromBulge(p1, p2, b);
    if (!arc) continue;
    const th = Math.abs(arc.sweep);
    seg += Math.sign(arc.sweep) * ((arc.r * arc.r) / 2) * (th - Math.sin(th));
  }
  return Math.abs(s2 / 2 + seg);
}

/**
 * The longest STRAIGHT run left between two fillets, for a unit radius.
 *
 * Once the fillets have eaten nearly all of every edge, what is left is a
 * circle with a few hundredths of a millimetre of flat on it - and it is still
 * being written out as a dozen vertices and a dozen arcs, which is a lot of
 * file for a shape that has a name. Measuring the run says when to stop
 * pretending. Scales with r, so it is worked out once per shape and rounding.
 */
const runCache = new Map();
export function straightRun(type, morph) {
  if (!MORPHABLE.has(type)) return Infinity;
  const m = Math.max(0, Math.min(1, morph ?? 1));
  const key = type + ':' + m.toFixed(5);
  const hit = runCache.get(key);
  if (hit !== undefined) return hit;
  const v = shapeVerts(type, 0, 0, 1, { morph: m });
  let longest = 0;
  for (let i = 0; i < v.length; i++) {
    const p1 = v[i];
    if (p1.length > 2 && p1[2]) continue; // an arc, not a run
    const p2 = v[(i + 1) % v.length];
    longest = Math.max(longest, Math.hypot(p2[0] - p1[0], p2[1] - p1[1]));
  }
  // No arcs at all means nothing has been filleted - the shape is as drawn.
  if (!v.some((q) => q.length > 2 && q[2])) longest = Infinity;
  runCache.set(key, longest);
  return longest;
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
      // A CAPSULE IS FOUR POINTS, NOT EIGHTEEN.
      //
      // Both ends are exact half circles of radius slw, so each is one ARC and
      // wants one vertex carrying a bulge - tan(sweep / 4), which for a half
      // turn is exactly 1. Drawn as nine chords apiece instead, the ends came
      // out as faceted polygons: eighteen points per slot where four will do,
      // an end that is not round, and a DXF that carries the error into the
      // machine. Every consumer here already reads bulges - the area integral
      // takes the circular segments, the extent sweeps the arcs, SVG emits A
      // and the DXF writes group code 42 - so this only had to stop
      // approximating.
      //
      // Counter-clockwise: left of the bottom cap, round UNDER to its right,
      // straight up the right side, right of the top cap, round OVER to its
      // left, straight down.
      verts.push(
        [cx - slw, cy - (sll - slw), 1],
        [cx + slw, cy - (sll - slw)],
        [cx + slw, cy + (sll - slw), 1],
        [cx - slw, cy + (sll - slw)]
      );
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
  // Turning a ring does not change any arc sweep, so the bulges ride along.
  return verts.map(([vx, vy, bg]) => {
    const dx = vx - cx;
    const dy = vy - cy;
    const q = [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca];
    return bg ? [q[0], q[1], bg] : q;
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
  //
  // A bulge becomes an SVG arc rather than a run of line segments, so the
  // preview shows the same curve the DXF carries instead of an approximation of
  // it - which is the whole reason both come from this one list. The flip
  // reverses the direction of travel, so the sweep flag is the opposite of the
  // bulge's sign.
  const fy = (vy) => fx(hole.cy - (vy - hole.cy));
  const out = [];
  for (let i = 0; i < verts.length; i++) {
    const p1 = verts[i];
    const p2 = verts[(i + 1) % verts.length];
    if (i === 0) out.push(`M${fx(p1[0])} ${fy(p1[1])}`);
    const b = p1.length > 2 ? p1[2] : 0;
    const arc = b ? arcFromBulge(p1, p2, b) : null;
    if (arc) {
      const large = Math.abs(arc.sweep) > Math.PI ? 1 : 0;
      out.push(`A${fx(arc.r)} ${fx(arc.r)} 0 ${large} ${b > 0 ? 1 : 0} ${fx(p2[0])} ${fy(p2[1])}`);
    } else if (i < verts.length - 1) {
      out.push(`L${fx(p2[0])} ${fy(p2[1])}`);
    }
  }
  return `${out.join(' ')} Z`;
}
