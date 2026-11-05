// Force mode physics. Kept free of DOM code so it can be tested in Node (forces.test.ts).
//
// Force mode is a force-directed layout that keeps the drawing's topology: PrEd (Bertault 2000),
// see docs/research/07-force-mode-feel.md. Edges pull towards one common length, vertices push
// each other apart when close, and vertices are pushed off edges, so the graph drifts towards an
// even, tidy drawing. But every tick, no vertex moves towards an edge by more than half of its
// distance to it (less a margin), and no edge moves towards a vertex by more than that either. So no vertex ever
// passes over an edge, and the crossings stay what they were: the crossing-free first layout stays
// crossing-free. Only a vertex dragged by hand can pass over an edge. The edge length is picked so
// the tidied drawing fills the canvas, and forceFill centres and stretches it to use the canvas.
import {
  forceCollide,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

export const NODE_RADIUS = 16;
export const START_ALPHA = 0.3;
// After a drop the physics starts warmer, so the graph comes after the dropped vertex briskly.
export const DROP_ALPHA = 0.5;
// Slower cooling than d3's default 0.0228: the drawing tidies up little by little, over about
// eight seconds, instead of stopping halfway.
const ALPHA_DECAY = 0.01;
const VELOCITY_DECAY = 0.5; // friction: share of the speed lost every tick
const COLLIDE_GAP = NODE_RADIUS * 0.8; // added to each radius: the gap vertices always keep
// Bounds of the common edge length, which is picked when force mode starts (captureRestState).
const MIN_LENGTH = NODE_RADIUS * 3;
const MAX_LENGTH = NODE_RADIUS * 16;
const DEFAULT_LENGTH = NODE_RADIUS * 6; // with no edges
// Vertices closer than REPEL_REACH edge lengths push each other apart by
// REPULSION × length² / distance, fading smoothly to nothing at the reach. A push that stops dead
// at its reach, like d3's forceManyBody with distanceMax, made the graph shake: a vertex at that
// distance was pushed out, felt nothing, came back and was pushed out again.
const REPEL_REACH = 2.5;
const REPULSION = 0.2;
// A vertex closer than EDGE_CLEARANCE to an edge it isn't part of is pushed straight away from
// it, and the edge's ends the other way (PrEd). Weaker or shorter-reaching, and long outer edges
// pressed vertices against themselves (16 px away in the dodecahedron, Petersen and K5).
const EDGE_CLEARANCE = NODE_RADIUS * 4;
const EDGE_PUSH = 1;
// Physics never brings a vertex closer than this to an edge it isn't part of, and pushes it out
// hard (not scaled by alpha, like collisions) if it is closer, for instance after a drop. Without
// that, edges could press a vertex ever closer to an edge until rounding put it on the other side.
// Two radii, so an edge passes a circle at least a radius away instead of touching it (the user,
// 2026-11-05: a Petersen vertex sat right against an edge).
const EDGE_MIN = NODE_RADIUS * 2;
const EDGE_MIN_PUSH = 0.5;

export interface Vertex extends SimulationNodeDatum {
  id: number;
  label: string;
  r: number; // drawn radius; grows for long labels
  dragged?: boolean; // held under the pointer (pinned with fx, fy)
  dropped?: boolean; // let go: stays pinned while the graph comes after it (until it cools down)
  layer?: string; // in a tree drawn in levels: vertices with the same layer stay on one level
  depth?: number; // and the level's number, 0 for the root at the top
  levelY?: number; // a held vertex's height when it was grabbed, for its level (forceLayers)
}

// Self-loops are not links.
export type Link = SimulationLinkDatum<Vertex> & { source: Vertex; target: Vertex };

export type GraphSimulation = Simulation<Vertex, Link>;

const isForeign = (v: Vertex, l: Link) => l.source !== v && l.target !== v;

// Distance from (px, py) to segment a-b, and the closest point's position t along it (0 at a).
function toSegment(px: number, py: number, a: Vertex, b: Vertex): { d: number; t: number } {
  const ex = b.x! - a.x!;
  const ey = b.y! - a.y!;
  const length2 = ex * ex + ey * ey;
  const t = length2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - a.x!) * ex + (py - a.y!) * ey) / length2));
  return { d: Math.hypot(px - a.x! - t * ex, py - a.y! - t * ey), t };
}

// A d3 force: every edge pulls or pushes its ends towards the common edge length, with the same
// strength as d3's forceLink (1 / the smaller degree of its ends), but shared equally between the
// two ends. d3's forceLink gives the end with fewer edges the bigger share, so its pushes don't add
// up to zero, and a tree (leaves have one edge, the others three) was always being pushed one way
// overall. The pull to the middle of the canvas used to cancel that; with it off while a vertex is
// held, grabbing one leaf sent the whole tree flying up (the user, 2026-11-05).
export function forceSprings() {
  let links: Link[] = [];
  let strengths: number[] = [];
  let length = DEFAULT_LENGTH;
  const force = (alpha: number) => {
    links.forEach(({ source: a, target: b }, i) => {
      // Where the ends are heading, as d3's forceLink does.
      const dx = b.x! + (b.vx ?? 0) - a.x! - (a.vx ?? 0);
      const dy = b.y! + (b.vy ?? 0) - a.y! - (a.vy ?? 0);
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) return;
      const k = (((d - length) / d) * alpha * strengths[i]) / 2;
      a.vx = (a.vx ?? 0) + dx * k;
      a.vy = (a.vy ?? 0) + dy * k;
      b.vx = (b.vx ?? 0) - dx * k;
      b.vy = (b.vy ?? 0) - dy * k;
    });
  };
  force.initialize = () => {};
  force.links = (next: Link[]) => {
    links = next;
    const degree = new Map<Vertex, number>();
    for (const { source, target } of links) {
      degree.set(source, (degree.get(source) ?? 0) + 1);
      degree.set(target, (degree.get(target) ?? 0) + 1);
    }
    strengths = links.map(({ source, target }) => 1 / Math.min(degree.get(source)!, degree.get(target)!));
    return force;
  };
  force.distance = (value: number) => {
    length = value;
    return force;
  };
  return force;
}

// Short-range repulsion between vertices (see REPULSION). Plain pairs: graphs here are small.
export function forceRepel() {
  let vertices: Vertex[] = [];
  let length = DEFAULT_LENGTH;
  const force = (alpha: number) => {
    const reach = REPEL_REACH * length;
    for (let i = 0; i < vertices.length; i++) {
      const u = vertices[i];
      for (let j = i + 1; j < vertices.length; j++) {
        const v = vertices[j];
        let dx = v.x! - u.x!;
        let dy = v.y! - u.y!;
        let d = Math.hypot(dx, dy);
        if (d >= reach) continue;
        if (d < 1e-6) {
          // On top of each other: split them along a direction fixed by their ids.
          dx = Math.cos(u.id * 2.4 + v.id);
          dy = Math.sin(u.id * 2.4 + v.id);
          d = 1;
        }
        const push = ((REPULSION * length * length) / Math.max(d, NODE_RADIUS)) * (1 - d / reach) ** 2 * alpha;
        const px = (dx / d) * push;
        const py = (dy / d) * push;
        u.vx = (u.vx ?? 0) - px;
        u.vy = (u.vy ?? 0) - py;
        v.vx = (v.vx ?? 0) + px;
        v.vy = (v.vy ?? 0) + py;
      }
    }
  };
  force.initialize = (nodes: Vertex[]) => {
    vertices = nodes;
  };
  force.edgeLength = (value: number) => {
    length = value;
    return force;
  };
  return force;
}

// A d3 force: each vertex is pushed away from nearby edges it doesn't belong to, and the edge's
// ends get the opposite push, shared by how close the vertex is to each (PrEd). A dragged vertex
// is pinned, so the whole push goes to the edge: an edge moves out of the way of a vertex dragged
// at it, as in CS Academy.
export function forceVertexEdge(clearance = EDGE_CLEARANCE, strength = EDGE_PUSH) {
  let vertices: Vertex[] = [];
  let links: Link[] = [];
  const force = (alpha: number) => {
    for (const v of vertices) {
      for (const l of links) {
        if (!isForeign(v, l)) continue;
        const { source: a, target: b } = l;
        const ex = b.x! - a.x!;
        const ey = b.y! - a.y!;
        const length2 = ex * ex + ey * ey;
        if (length2 < 1e-9) continue;
        const { d: distance, t } = toSegment(v.x!, v.y!, a, b);
        if (distance >= clearance) continue;
        let dx = v.x! - (a.x! + t * ex);
        let dy = v.y! - (a.y! + t * ey);
        let d = distance;
        if (d < 1e-6) {
          // Exactly on the edge: push along the edge's normal.
          const length = Math.sqrt(length2);
          dx = -ey / length;
          dy = ex / length;
          d = 1;
        } else {
          dx /= d;
          dy /= d;
        }
        const push = (clearance - d) * strength * alpha + Math.max(0, EDGE_MIN - d) * EDGE_MIN_PUSH;
        v.vx = (v.vx ?? 0) + dx * push;
        v.vy = (v.vy ?? 0) + dy * push;
        a.vx = (a.vx ?? 0) - dx * push * (1 - t);
        a.vy = (a.vy ?? 0) - dy * push * (1 - t);
        b.vx = (b.vx ?? 0) - dx * push * t;
        b.vy = (b.vy ?? 0) - dy * push * t;
      }
    }
  };
  force.initialize = (nodes: Vertex[]) => {
    vertices = nodes;
  };
  force.links = (next: Link[]) => {
    links = next;
    return force;
  };
  return force;
}

// A d3 force that must run last: it shortens the moves all the other forces asked for, so that
// in one tick no vertex passes over an edge and no edge passes over a vertex (PrEd). For each
// vertex and each edge it isn't part of, with g = (distance - EDGE_MIN) / 2: the vertex may come
// at most g closer to the edge, and so may each end of the edge come at most g towards the
// vertex's side. (Checking each end, not just the nearest point, also catches an edge swinging
// round to hit the vertex with its far end.) Together they can close at most distance - EDGE_MIN,
// so they never come closer than EDGE_MIN.
//
// Only the part of a move aimed at the edge is limited; the rest of the move is kept. That is
// enough: the distance from a point to a segment shrinks by at most the part of the move along
// the line from the segment to the point. Limiting the whole move instead (until 2026-11-05)
// stopped a vertex between two edges dead: a move only slightly towards one of them was cancelled
// altogether, so a vertex an edge had been dragged over could stay on it.
export function forceKeepCrossings(decay = VELOCITY_DECAY) {
  let vertices: Vertex[] = [];
  let links: Link[] = [];
  const force = () => {
    // For each vertex: directions it must not move far along (unit vectors) and how far it may.
    const limits = new Map<Vertex, { ux: number; uy: number; room: number }[]>();
    const most = new Map<Vertex, number>(); // a limit on the whole move, for a vertex on an edge
    const limit = (v: Vertex, ux: number, uy: number, room: number) => {
      if (v.fx != null) return; // pinned: moved by hand, not by velocity
      const list = limits.get(v) ?? [];
      list.push({ ux, uy, room });
      limits.set(v, list);
    };
    for (const l of links) {
      const { source: a, target: b } = l;
      for (const w of vertices) {
        if (!isForeign(w, l)) continue;
        const { d, t } = toSegment(w.x!, w.y!, a, b);
        const room = Math.max(0, d - EDGE_MIN) / 2;
        if (d < 1e-6) {
          // On the edge: no side to keep; just don't let the edge move a lot.
          for (const end of [a, b]) most.set(end, Math.min(most.get(end) ?? Infinity, room));
          continue;
        }
        // Unit direction from the edge to the vertex.
        const nx = (w.x! - (a.x! + t * (b.x! - a.x!))) / d;
        const ny = (w.y! - (a.y! + t * (b.y! - a.y!))) / d;
        limit(w, -nx, -ny, room);
        limit(a, nx, ny, room);
        limit(b, nx, ny, room);
      }
    }
    const k = 1 - decay; // a tick moves a vertex by its velocity times this
    const excess = (v: Vertex, { ux, uy, room }: { ux: number; uy: number; room: number }) =>
      ((v.vx ?? 0) * ux + (v.vy ?? 0) * uy) * k - room;
    for (const [v, list] of limits) {
      // Take away the part of the move beyond each limit. Doing that for one limit can push the
      // move over another, so repeat a few times, then shorten the whole move if still needed.
      for (let round = 0; round < 4; round++) {
        let fine = true;
        for (const c of list) {
          const over = excess(v, c);
          if (over <= 1e-9) continue;
          fine = false;
          v.vx = (v.vx ?? 0) - (c.ux * over) / k;
          v.vy = (v.vy ?? 0) - (c.uy * over) / k;
        }
        if (fine) break;
      }
      let scale = 1;
      for (const c of list) {
        const along = ((v.vx ?? 0) * c.ux + (v.vy ?? 0) * c.uy) * k;
        if (along > c.room + 1e-9) scale = Math.min(scale, c.room / along);
      }
      v.vx = (v.vx ?? 0) * scale;
      v.vy = (v.vy ?? 0) * scale;
    }
    for (const [v, value] of most) {
      if (v.fx != null) continue;
      const moves = Math.hypot(v.vx ?? 0, v.vy ?? 0) * k;
      if (moves <= value) continue;
      v.vx = (v.vx ?? 0) * (value / moves);
      v.vy = (v.vy ?? 0) * (value / moves);
    }
  };
  force.initialize = (nodes: Vertex[]) => {
    vertices = nodes;
  };
  force.links = (next: Link[]) => {
    links = next;
    return force;
  };
  return force;
}

// In a tree drawn in levels (root at the top, each level on one horizontal line, as the first
// layout and Arrange draw trees), each level is pulled onto one horizontal line, so force mode
// keeps the tree drawn top-down and only spreads it sideways. Without it, the even spreading
// turned trees into a fan (the user, 2026-11-05: "draw the tree as before").
const LAYER_PULL = 0.2; // share of the way to its level's height per tick
const LAYER_TOLERANCE = 2; // px: how level a level must be to count as one
// And every vertex of such a tree is kept at least LEVEL_GAP below its parent, so the tree stays
// upright: dragging the root through the tree folded it, with lower levels above upper ones.
const LEVEL_GAP = NODE_RADIUS * 3;
const LEVEL_PUSH = 0.2;

// Marks the vertices of each tree component drawn in levels with their layer (see LAYER_PULL),
// and clears the mark everywhere else.
function markLayers(vertices: Vertex[], links: Link[]): void {
  const next = new Map<Vertex, Vertex[]>(vertices.map((v) => [v, []]));
  for (const l of links) {
    next.get(l.source)?.push(l.target);
    next.get(l.target)?.push(l.source);
  }
  const seen = new Set<Vertex>();
  let component = 0;
  for (const start of vertices) {
    if (seen.has(start)) continue;
    const members = [start];
    seen.add(start);
    for (let i = 0; i < members.length; i++) {
      for (const w of next.get(members[i])!) {
        if (seen.has(w)) continue;
        seen.add(w);
        members.push(w);
      }
    }
    component++;
    for (const v of members) v.layer = v.depth = undefined;
    const edges = members.reduce((sum, v) => sum + next.get(v)!.length, 0) / 2;
    if (members.length < 3 || edges !== members.length - 1) continue; // not a tree
    // The root is the top vertex; levels are distances from it.
    const root = members.reduce((top, v) => (v.y! < top.y! ? v : top));
    const depth = new Map([[root, 0]]);
    const order = [root];
    for (let i = 0; i < order.length; i++) {
      for (const w of next.get(order[i])!) {
        if (depth.has(w)) continue;
        depth.set(w, depth.get(order[i])! + 1);
        order.push(w);
      }
    }
    const levelY = new Map<number, number>();
    let layered = true;
    for (const v of members) {
      const y = levelY.get(depth.get(v)!);
      if (y === undefined) levelY.set(depth.get(v)!, v.y!);
      else if (Math.abs(y - v.y!) > LAYER_TOLERANCE) layered = false;
    }
    for (let d = 1; layered && levelY.has(d); d++) if (levelY.get(d)! <= levelY.get(d - 1)! + LAYER_TOLERANCE) layered = false;
    // A path drawn as a slanted line has one vertex per level: that isn't drawn in levels.
    if (levelY.size === members.length) layered = false;
    if (!layered) continue;
    for (const v of members) {
      v.depth = depth.get(v);
      v.layer = `${component}:${v.depth}`;
    }
  }
}

// A d3 force for trees drawn in levels: pulls the vertices of each level towards the level's mean
// height (see LAYER_PULL), and pushes a vertex closer than LEVEL_GAP below its parent down, and
// the parent up. A held or dropped vertex counts for its level's height at the height it was
// grabbed at, so dragging it doesn't drag its level along, but it does push its parent and
// children, so the tree follows it upright. Leaving it out of its level altogether made the tree
// fly off as soon as a leaf was grabbed: the level had been holding that leaf against its edge,
// and without it, the rest of the level gave way (the user, 2026-11-05).
// Not faded by alpha: the levels stay level as the simulation cools.
export function forceLayers() {
  let vertices: Vertex[] = [];
  let links: Link[] = [];
  const force = () => {
    const levels = new Map<string, { sum: number; count: number }>();
    for (const v of vertices) {
      if (v.layer == null) continue;
      const level = levels.get(v.layer) ?? { sum: 0, count: 0 };
      level.sum += v.fy != null ? (v.levelY ?? v.y!) : v.y!;
      level.count++;
      levels.set(v.layer, level);
    }
    for (const v of vertices) {
      if (v.layer == null || v.fy != null) continue;
      const { sum, count } = levels.get(v.layer)!;
      if (count > 1) v.vy = (v.vy ?? 0) + (sum / count - v.y!) * LAYER_PULL;
    }
    for (const { source, target } of links) {
      if (source.depth == null || target.depth == null) continue;
      const [upper, lower] = source.depth < target.depth ? [source, target] : [target, source];
      const short = LEVEL_GAP - (lower.y! - upper.y!);
      if (short <= 0) continue;
      // Shared between the two, or all to the free one if the other is held.
      const share = upper.fy != null ? [0, 1] : lower.fy != null ? [1, 0] : [0.5, 0.5];
      upper.vy = (upper.vy ?? 0) - short * LEVEL_PUSH * share[0];
      lower.vy = (lower.vy ?? 0) + short * LEVEL_PUSH * share[1];
    }
  };
  force.initialize = (nodes: Vertex[]) => {
    vertices = nodes;
  };
  force.links = (next: Link[]) => {
    links = next;
    return force;
  };
  return force;
}

// Where vertices may be: the canvas, or more of the page when the view is zoomed out (widget.ts).
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Canvas {
  width: number;
  height: number;
}

const canvasBounds = ({ width, height }: Canvas): Bounds => ({ left: 0, top: 0, right: width, bottom: height });

// Keeps a vertex inside the bounds. One pushed against the border stops there instead of keeping
// its speed into it, which made vertices piled at the border jitter.
export function keepInside(v: Vertex, { left, top, right, bottom }: Bounds): void {
  const x = Math.min(Math.max(v.x ?? 0, left + v.r), right - v.r);
  const y = Math.min(Math.max(v.y ?? 0, top + v.r), bottom - v.r);
  if (x !== v.x) v.vx = 0;
  if (y !== v.y) v.vy = 0;
  v.x = x;
  v.y = y;
}

// Vertices closer than BORDER_GAP to the border of the bounds (between circle and border) are
// pushed back in, not scaled by alpha, like collisions. Before, a vertex only stopped at the
// border, and the graph could rest pressed against it, with vertices and edges squeezed there
// (seen in Petersen).
export const BORDER_GAP = NODE_RADIUS;
const BORDER_PUSH = 0.3;

export function forceBorder() {
  let vertices: Vertex[] = [];
  let bounds: Bounds | undefined;
  const force = () => {
    if (!bounds) return;
    const { left, top, right, bottom } = bounds;
    for (const v of vertices) {
      const room = v.r + BORDER_GAP;
      v.vx = (v.vx ?? 0) + (Math.max(0, left + room - v.x!) - Math.max(0, v.x! - (right - room))) * BORDER_PUSH;
      v.vy = (v.vy ?? 0) + (Math.max(0, top + room - v.y!) - Math.max(0, v.y! - (bottom - room))) * BORDER_PUSH;
    }
  };
  force.initialize = (nodes: Vertex[]) => {
    vertices = nodes;
  };
  force.bounds = (value: Bounds | undefined) => {
    bounds = value;
    return force;
  };
  force.current = () => bounds;
  return force;
}

// How the drawing should fill the canvas: its vertices (with their circles) span this share of
// the canvas, less CANVAS_MARGIN on each side.
const FILL = 0.9;
const CANVAS_MARGIN = NODE_RADIUS;
const FILL_PUSH = 0.3;
// The most the drawing is stretched in one direction. More made a nearly straight path buckle:
// stretching pushes a vertex away from the middle across a straight line, and nothing pulls it back.
const MAX_STRETCH = 1.3;

// The span of the drawing in each direction as a share of the room the canvas has for it.
function spanOf(vertices: Vertex[], canvas: Canvas): { x: number; y: number; cx: number; cy: number } {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const v of vertices) {
    left = Math.min(left, v.x! - v.r);
    right = Math.max(right, v.x! + v.r);
    top = Math.min(top, v.y! - v.r);
    bottom = Math.max(bottom, v.y! + v.r);
  }
  return {
    x: (right - left) / (canvas.width - 2 * CANVAS_MARGIN),
    y: (bottom - top) / (canvas.height - 2 * CANVAS_MARGIN),
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
  };
}

// A d3 force that makes the drawing use the canvas. Each vertex is pulled towards where it would
// be if the drawing were stretched to fill FILL of the canvas in each direction where it fills
// less (by at most MAX_STRETCH) and, while no vertex is held or dropped, moved to the middle of
// the canvas. The edge length is picked so the drawing fits the tighter direction
// (captureRestState); this stretches it in the other one, as the first layout does. Moving a
// drawing or stretching it in one direction doesn't change its crossings.
//
// With a vertex held or dropped the drawing isn't moved to the middle, so the graph can come after
// that vertex, but it is still stretched: switching the whole force off made the graph shrink the
// moment a vertex was touched, since the stretch holds it against its edges (the user, 2026-11-05).
// Keeping the stretch of the moment before the grab instead was unstable: a drawing that grew a
// little was pushed to grow more, until it hit the border.
//
// The stretch is around the mean position of the vertices that aren't held, so it never moves the
// drawing as a whole: around the middle of the drawing's box, it did, and with the pull to the
// middle off, a held vertex at the edge of the drawing made all the others slide 45 px away.
export function forceFill() {
  let vertices: Vertex[] = [];
  let canvas: Canvas | undefined;
  const force = (alpha: number) => {
    if (!canvas || vertices.length < 2) return;
    const span = spanOf(vertices, canvas);
    const sx = span.x > 1e-6 && span.x < FILL ? Math.min(FILL / span.x, MAX_STRETCH) : 1;
    const sy = span.y > 1e-6 && span.y < FILL ? Math.min(FILL / span.y, MAX_STRETCH) : 1;
    const held = vertices.some((v) => v.dragged || v.dropped);
    // Moving to the middle: by how much the drawing's box is off it.
    const [dx, dy] = held ? [0, 0] : [canvas.width / 2 - span.cx, canvas.height / 2 - span.cy];
    const free = vertices.filter((v) => v.fx == null);
    if (free.length === 0) return;
    const mx = free.reduce((sum, v) => sum + v.x!, 0) / free.length;
    const my = free.reduce((sum, v) => sum + v.y!, 0) / free.length;
    const k = FILL_PUSH * alpha;
    for (const v of free) {
      v.vx = (v.vx ?? 0) + (dx + (v.x! - mx) * (sx - 1)) * k;
      v.vy = (v.vy ?? 0) + (dy + (v.y! - my) * (sy - 1)) * k;
    }
  };
  force.initialize = (nodes: Vertex[]) => {
    vertices = nodes;
  };
  force.canvas = (value: Canvas | undefined) => {
    canvas = value;
    return force;
  };
  return force;
}

// The common edge length of each simulation (see MIN_LENGTH), and its canvas.
const lengths = new WeakMap<GraphSimulation, number>();
const canvases = new WeakMap<GraphSimulation, Canvas | undefined>();

export function createSimulation(): GraphSimulation {
  const sim = forceSimulation<Vertex, Link>()
    .alphaDecay(ALPHA_DECAY)
    .velocityDecay(VELOCITY_DECAY)
    .force("link", forceSprings())
    .force("repel", forceRepel())
    .force("collide", forceCollide<Vertex>((v) => v.r + COLLIDE_GAP))
    .force("edges", forceVertexEdge())
    .force("fill", forceFill())
    .force("layers", forceLayers())
    .force("border", forceBorder())
    // Must stay the last force: it checks the moves all the others produced.
    .force("crossings", forceKeepCrossings())
    .stop();
  lengths.set(sim, DEFAULT_LENGTH);
  return sim;
}

const LABEL_MARGIN = 6; // space between a label and its circle

// Radius of a vertex whose label is `textWidth` pixels wide: long labels such as "(0, 1)"
// would not fit in the default circle.
export function radiusForLabel(textWidth: number): number {
  return Math.max(NODE_RADIUS, textWidth / 2 + LABEL_MARGIN);
}

// d3 caches accessor results; re-run them after vertices, edges or radii change.
export function refreshForces(sim: GraphSimulation, vertices: Vertex[], links: Link[]): void {
  const length = lengths.get(sim) ?? DEFAULT_LENGTH;
  sim.nodes(vertices);
  sim.force<ReturnType<typeof forceSprings>>("link")!.links(links).distance(length);
  sim.force<ReturnType<typeof forceRepel>>("repel")!.edgeLength(length);
  sim.force<ReturnType<typeof forceVertexEdge>>("edges")!.links(links);
  sim.force<ReturnType<typeof forceKeepCrossings>>("crossings")!.links(links);
  sim.force<ReturnType<typeof forceLayers>>("layers")!.links(links);
  sim.force<ReturnType<typeof forceCollide<Vertex>>>("collide")!.radius((v) => v.r + COLLIDE_GAP);
}

// The trial tidies until the simulation stops, but does at most TRIAL_WORK vertex-pair and
// vertex-edge checks (and at least TRIAL_MIN_TICKS ticks), so turning force mode on doesn't hang
// on big graphs: a 225-vertex grid took 3.7 s without the limit. A shorter trial on big graphs
// guesses the size less exactly.
const TRIAL_WORK = 8e6;
const TRIAL_MIN_TICKS = 50;

const trialTicks = (vertices: Vertex[], links: Link[]) =>
  Math.max(TRIAL_MIN_TICKS, Math.floor(TRIAL_WORK / (vertices.length ** 2 + 2 * vertices.length * links.length)));

const copyOf = (v: Vertex): Vertex => ({ id: v.id, label: v.label, r: v.r, x: v.x, y: v.y, layer: v.layer, depth: v.depth });

// Tidies a copy of the drawing with edge length `length`, without moving the real vertices, and
// returns how much of the canvas the result fills.
function trialFill(vertices: Vertex[], links: Link[], length: number, canvas: Canvas): number {
  const copies = new Map(vertices.map((v) => [v, copyOf(v)]));
  const copiedLinks = links.map((l) => ({ source: copies.get(l.source)!, target: copies.get(l.target)! }));
  const trial = createSimulation();
  lengths.set(trial, length);
  refreshForces(trial, [...copies.values()], copiedLinks);
  trial.alpha(START_ALPHA);
  for (let i = 0; i < trialTicks(vertices, links) && trial.alpha() > trial.alphaMin(); i++) trial.tick();
  const span = spanOf([...copies.values()], canvas);
  return Math.max(span.x, span.y);
}

// Picks the common edge length when force mode starts, and after Arrange. Without a canvas: the
// median edge length of the drawing as it is. With one: the length at which the tidied drawing
// fills the canvas (FILL), found by tidying a copy first. The size of a tidy drawing grows with
// its edge length, so one trial says how much longer or shorter the edges should be. Taking the
// median alone shrank drawings whose first layout has many short edges (the dodecahedron to
// 335 x 351 px on the 800 x 500 canvas), and a bigger length alone pressed drawings against the
// canvas border and vertices against edges.
export function captureRestState(
  sim: GraphSimulation,
  vertices: Vertex[],
  links: Link[],
  canvas?: Canvas,
  bounds?: Bounds,
): void {
  releaseDropped(vertices);
  markLayers(vertices, links);
  const sorted = links.map((l) => Math.hypot(l.source.x! - l.target.x!, l.source.y! - l.target.y!)).sort((p, q) => p - q);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : DEFAULT_LENGTH;
  let length = Math.min(Math.max(median, MIN_LENGTH), MAX_LENGTH);
  if (canvas && links.length > 0 && vertices.length > 2) {
    const fill = trialFill(vertices, links, length, canvas);
    if (fill > 1e-6) length = Math.min(Math.max((length * FILL) / fill, MIN_LENGTH), MAX_LENGTH);
  }
  lengths.set(sim, length);
  sim.force<ReturnType<typeof forceFill>>("fill")!.canvas(canvas);
  canvases.set(sim, canvas);
  const border = sim.force<ReturnType<typeof forceBorder>>("border")!;
  border.bounds(canvas && (bounds ?? canvasBounds(canvas)));
  refreshForces(sim, vertices, links);
}

// Where vertices may be, when the view is zoomed out further than the canvas (widget.ts).
export function setBounds(sim: GraphSimulation, bounds: Bounds): void {
  const border = sim.force<ReturnType<typeof forceBorder>>("border")!;
  if (border.current()) border.bounds(bounds);
}

// Tidies the drawing at once, without showing it: runs force mode on a copy until it stops (or
// for as long as the trial may, on big graphs) and returns where each vertex ends up. Call
// captureRestState first. After Arrange the vertices glide straight there; before, they glided to
// the first layout and force mode then moved them all again, which looked like a jump.
export function tidied(sim: GraphSimulation, vertices: Vertex[], links: Link[]): Map<Vertex, [number, number]> {
  const copies = new Map(vertices.map((v) => [v, copyOf(v)]));
  const copiedLinks = links.map((l) => ({ source: copies.get(l.source)!, target: copies.get(l.target)! }));
  const copy = createSimulation();
  lengths.set(copy, lengths.get(sim) ?? DEFAULT_LENGTH);
  const canvas = canvases.get(sim);
  const bounds = sim.force<ReturnType<typeof forceBorder>>("border")!.current();
  copy.force<ReturnType<typeof forceFill>>("fill")!.canvas(canvas);
  copy.force<ReturnType<typeof forceBorder>>("border")!.bounds(bounds);
  refreshForces(copy, [...copies.values()], copiedLinks);
  copy.alpha(START_ALPHA);
  for (let i = 0; i < trialTicks(vertices, links) && copy.alpha() > copy.alphaMin(); i++) {
    copy.tick();
    if (bounds) for (const v of copies.values()) keepInside(v, bounds);
  }
  return new Map([...copies].map(([v, c]) => [v, [c.x!, c.y!]]));
}

// Force mode drag, as in CS Academy: the vertex is held exactly under the pointer. Edges and
// vertices in its way get pushed aside, and its edges pull the rest of the graph after it.
export function startDrag(vertex: Vertex, vertices: Vertex[]): void {
  releaseDropped(vertices);
  vertex.dragged = true;
  vertex.fx = vertex.x;
  vertex.fy = vertex.y;
  vertex.levelY = vertex.y;
}

export function moveDrag(vertex: Vertex, x: number, y: number): void {
  vertex.x = vertex.fx = x;
  vertex.y = vertex.fy = y;
}

// The drop: the vertex stays where it was dropped while the rest of the graph comes after it,
// until the simulation cools down (releaseDropped), as in CS Academy.
export function endDrag(vertex: Vertex): void {
  vertex.dragged = false;
  vertex.dropped = true;
}

// Lets go of held and dropped vertices: when the simulation stops, and before anything else
// (another drag, freezing, Arrange). Returns whether there was any.
export function releaseDropped(vertices: Vertex[]): boolean {
  let any = false;
  for (const v of vertices) {
    if (!v.dropped && !v.dragged) continue;
    any = true;
    v.dropped = v.dragged = false;
    v.fx = v.fy = null;
    v.levelY = undefined;
  }
  return any;
}
