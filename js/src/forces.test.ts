import assert from "node:assert/strict";
import { test } from "node:test";
import fixture from "../test/dodecahedron.json";
import demo from "../test/demo-graphs.json";
// The dodecahedron as Arrange for looks draws it (looks_layout, in pixels of the 800 x 500 canvas).
import looksFixture from "../test/dodecahedron-looks.json";
import {
  captureRestState,
  createSimulation,
  DROP_ALPHA,
  endDrag,
  moveDrag,
  NODE_RADIUS,
  radiusForLabel,
  refreshForces,
  releaseDropped,
  setBounds,
  START_ALPHA,
  startDrag,
  tidied,
  untangle,
  type GraphSimulation,
  type Link,
  type Vertex,
} from "./forces";

type Drawing = { nodes: number[][]; edges: number[][] };

function build({ nodes, edges }: Drawing): { vertices: Vertex[]; links: Link[] } {
  const byId = new Map<number, Vertex>();
  for (const [id, x, y] of nodes) byId.set(id, { id, label: String(id), r: NODE_RADIUS, x, y });
  const links = edges.map(([u, v]) => ({ source: byId.get(u)!, target: byId.get(v)! }));
  return { vertices: [...byId.values()], links };
}

// The demo graphs of main.ipynb as the first layout draws them.
const DRAWINGS: Record<string, Drawing> = { dodecahedron: fixture, ...(demo as unknown as Record<string, Drawing>) };
delete DRAWINGS.note;

const vertex = (id: number, x: number, y: number): Vertex => ({ id, label: String(id), r: NODE_RADIUS, x, y });
const link = (source: Vertex, target: Vertex): Link => ({ source, target });

function crossings(links: Link[]): number {
  const o = (a: Vertex, b: Vertex, c: Vertex) => (b.x! - a.x!) * (c.y! - a.y!) - (b.y! - a.y!) * (c.x! - a.x!);
  let count = 0;
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) {
      const { source: a, target: b } = links[i];
      const { source: c, target: d } = links[j];
      if (new Set([a, b, c, d]).size < 4) continue;
      if (o(c, d, a) * o(c, d, b) < 0 && o(a, b, c) * o(a, b, d) < 0) count++;
    }
  }
  return count;
}

// The widget's default canvas. Like widget.ts, the tests keep every vertex on it after each tick.
const CANVAS = { width: 800, height: 500 };

function tick(sim: GraphSimulation): void {
  sim.tick();
  for (const v of sim.nodes()) {
    const x = Math.min(Math.max(v.x!, v.r), CANVAS.width - v.r);
    const y = Math.min(Math.max(v.y!, v.r), CANVAS.height - v.r);
    if (x !== v.x) v.vx = 0;
    if (y !== v.y) v.vy = 0;
    v.x = x;
    v.y = y;
  }
}

// Force mode switched on and left alone until the simulation stops.
function settle(vertices: Vertex[], links: Link[]): GraphSimulation {
  const sim = createSimulation();
  captureRestState(sim, vertices, links, CANVAS);
  sim.alpha(START_ALPHA);
  while (sim.alpha() > sim.alphaMin()) tick(sim);
  return sim;
}

// A drag the way widget.ts does it in force mode: the pointer moves to (x, y) in `steps` moves,
// one tick each, waits `hold` ticks there, then lets go, and the physics runs until it stops.
// `onTick` sees every tick of the drag, `afterDrop` every tick after it. Returns where the dragged
// vertex was dropped.
function drag(sim: GraphSimulation, vertices: Vertex[], dragged: Vertex, x: number, y: number, steps = 30, hold = 30, onTick = () => {}, afterDrop = () => {}) {
  sim.alphaTarget(0.3).alpha(0.3);
  startDrag(dragged, vertices);
  const [x0, y0] = [dragged.x!, dragged.y!];
  for (let step = 1; step <= steps + hold; step++) {
    const k = Math.min(step, steps) / steps;
    moveDrag(dragged, x0 + (x - x0) * k, y0 + (y - y0) * k);
    tick(sim);
    onTick();
  }
  endDrag(dragged);
  const dropped = [dragged.x!, dragged.y!];
  sim.alphaTarget(0).alpha(DROP_ALPHA);
  while (sim.alpha() > sim.alphaMin()) {
    tick(sim);
    afterDrop();
  }
  releaseDropped(vertices); // what widget.ts does when the simulation stops
  return dropped;
}

function simulation(vertices: Vertex[], links: Link[]): GraphSimulation {
  const sim = createSimulation();
  captureRestState(sim, vertices, links, CANVAS);
  return sim;
}

const distanceToEdge = (v: Vertex, { source: a, target: b }: Link) => {
  const ex = b.x! - a.x!;
  const ey = b.y! - a.y!;
  const t = Math.max(0, Math.min(1, ((v.x! - a.x!) * ex + (v.y! - a.y!) * ey) / (ex * ex + ey * ey)));
  return Math.hypot(v.x! - a.x! - t * ex, v.y! - a.y! - t * ey);
};

const lengthOf = ({ source, target }: Link) => Math.hypot(source.x! - target.x!, source.y! - target.y!);

for (const [name, drawing] of Object.entries(DRAWINGS)) {
  test(`force mode keeps the crossings of the first layout: ${name}`, () => {
    // Tidying must not undo the first layout's work: its crossings, 0 for planar graphs, stay what
    // they were. The editor opens on the tidied drawing (research/07).
    const { vertices, links } = build(drawing);
    const before = crossings(links);
    settle(vertices, links);
    assert.equal(crossings(links), before);
  });
}

for (const [name, drawing] of Object.entries(DRAWINGS)) {
  test(`after tidying no vertex is left pressed against an edge: ${name}`, () => {
    // Regression (2026-11-05): long outer edges pressed vertices against themselves, 16 px away,
    // in the dodecahedron, Petersen and K5.
    const { vertices, links } = build(drawing);
    settle(vertices, links);
    let closest = Infinity;
    for (const l of links) for (const v of vertices) if (v !== l.source && v !== l.target) closest = Math.min(closest, distanceToEdge(v, l));
    assert.ok(closest > NODE_RADIUS * 2, `a vertex is only ${closest.toFixed(0)} px from an edge`);
  });
}

test("force mode spreads the drawing over the canvas", () => {
  // The user (2026-11-05): the tidied dodecahedron was cramped, 335 x 351 px in the middle of the
  // 800 x 500 canvas, because the edge length was the first layout's median.
  const { vertices, links } = build(DRAWINGS.dodecahedron);
  settle(vertices, links);
  const xs = vertices.map((v) => v.x!);
  const ys = vertices.map((v) => v.y!);
  const [width, height] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  assert.ok(width > CANVAS.width * 0.6 && height > CANVAS.height * 0.7, `the drawing spans only ${width.toFixed(0)} x ${height.toFixed(0)} px`);
  // In the middle, and clear of the border.
  const middle = (Math.max(...xs) + Math.min(...xs)) / 2;
  assert.ok(Math.abs(middle - CANVAS.width / 2) < 40, `the drawing's middle is at x = ${middle.toFixed(0)}`);
  for (const v of vertices) assert.ok(v.x! > v.r + 1 && v.x! < CANVAS.width - v.r - 1 && v.y! > v.r + 1 && v.y! < CANVAS.height - v.r - 1, `vertex ${v.id} is against the border`);
});

test("a tree drawn in levels stays drawn in levels", () => {
  // The user (2026-11-05): force mode turned the first layout's top-down tree into a fan.
  const { vertices, links } = build(DRAWINGS.tree);
  const levelOf = new Map(vertices.map((v) => [v.id, Math.floor(Math.log2(v.id + 1))])); // balanced_tree(2, 3)
  settle(vertices, links);
  const levels = [0, 1, 2, 3].map((level) => vertices.filter((v) => levelOf.get(v.id) === level).map((v) => v.y!));
  for (const ys of levels) assert.ok(Math.max(...ys) - Math.min(...ys) < 3, `a level spans ${(Math.max(...ys) - Math.min(...ys)).toFixed(0)} px in height`);
  for (let level = 1; level < 4; level++) assert.ok(levels[level][0] > levels[level - 1][0] + 2 * NODE_RADIUS, `level ${level} isn't below level ${level - 1}`);
});

test("a tree stays upright when its root is dragged down through it", () => {
  // Regression: the tree folded, with lower levels ending above upper ones.
  const { vertices, links } = build(DRAWINGS.tree);
  const sim = settle(vertices, links);
  const root = vertices.find((v) => v.id === 0)!;
  drag(sim, vertices, root, root.x!, CANVAS.height / 2, 40, 30); // below levels 1 and 2
  const byId = new Map(vertices.map((v) => [v.id, v]));
  for (const v of vertices) {
    if (v.id === 0) continue;
    const parent = byId.get(Math.floor((v.id - 1) / 2))!; // balanced_tree(2, 3)
    assert.ok(v.y! > parent.y! + NODE_RADIUS, `vertex ${v.id} at y = ${v.y!.toFixed(0)} isn't below its parent at ${parent.y!.toFixed(0)}`);
  }
});

test("holding a leaf of a tree doesn't send the tree flying", () => {
  // The user (2026-11-05): grab one leaf and the whole tree flew up. d3's edge springs don't push
  // both ends equally, so a tree was always pushed one way overall (only the pull to the middle,
  // off while a vertex is held, cancelled it), and a held leaf was left out of its level.
  const { vertices, links } = build(DRAWINGS.tree);
  const sim = createSimulation();
  captureRestState(sim, vertices, links, CANVAS);
  for (const [v, [x, y]] of tidied(sim, vertices, links)) [v.x, v.y] = [x, y]; // as the editor opens
  sim.alpha(0);
  for (const id of [7, 14]) {
    const before = vertices.map((v) => [v.x!, v.y!]);
    const leaf = vertices.find((v) => v.id === id)!;
    startDrag(leaf, vertices);
    sim.alphaTarget(0.3);
    for (let t = 0; t < 120; t++) tick(sim); // held still for two seconds
    const moved = Math.max(...vertices.map((v, i) => Math.hypot(v.x! - before[i][0], v.y! - before[i][1])));
    assert.ok(moved < 15, `holding leaf ${id}, a vertex moved ${moved.toFixed(0)} px`);
    releaseDropped(vertices);
  }
});

test("a vertex near the canvas border is pushed back in", () => {
  // Regression: a vertex only stopped at the border, so the graph could rest pressed against it.
  // The other vertex is dropped, which turns off centring, so only the border push can do it.
  const [a, b] = [vertex(0, NODE_RADIUS, 250), vertex(1, 600, 250)];
  const sim = simulation([a, b], []);
  b.dropped = true;
  [b.fx, b.fy] = [b.x, b.y];
  sim.alpha(START_ALPHA);
  for (let t = 0; t < 100; t++) tick(sim);
  // (The stretch over the canvas pushes it out a little, so it ends short of the full gap.)
  assert.ok(a.x! > NODE_RADIUS + 8, `the vertex is still at x = ${a.x!.toFixed(1)}`);
});

const spanOfAll = (vertices: Vertex[]) => {
  const xs = vertices.map((v) => v.x!);
  const ys = vertices.map((v) => v.y!);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};

test("touching a vertex doesn't make the graph shrink", () => {
  // The user (2026-11-05): the moment a vertex was grabbed, all edges pulled together. The pull
  // that stretches the drawing over the canvas was switched off while a vertex was held.
  const { vertices, links } = build(DRAWINGS.dodecahedron);
  const sim = settle(vertices, links);
  const [width, height] = spanOfAll(vertices);
  const held = vertices[0];
  startDrag(held, vertices);
  sim.alphaTarget(0.3).alpha(0.3);
  for (let t = 0; t < 120; t++) tick(sim); // held still for two seconds
  const [width2, height2] = spanOfAll(vertices);
  assert.ok(width2 > width * 0.97 && height2 > height * 0.97, `${width.toFixed(0)} x ${height.toFixed(0)} px shrank to ${width2.toFixed(0)} x ${height2.toFixed(0)}`);
});

test("a drawing tidied at once doesn't move when physics runs", () => {
  // Arrange glides to this drawing. Regression: it glided to the first layout, and force mode
  // then moved every vertex again, which looked like a jump.
  const { vertices, links } = build(DRAWINGS.dodecahedron);
  const sim = createSimulation();
  captureRestState(sim, vertices, links, CANVAS);
  for (const [v, [x, y]] of tidied(sim, vertices, links)) [v.x, v.y] = [x, y];
  const before = vertices.map((v) => [v.x!, v.y!]);
  sim.alpha(START_ALPHA); // force mode warmed up again, as when it is switched on
  while (sim.alpha() > sim.alphaMin()) tick(sim);
  const moved = Math.max(...vertices.map((v, i) => Math.hypot(v.x! - before[i][0], v.y! - before[i][1])));
  assert.ok(moved < 20, `a vertex moved ${moved.toFixed(0)} px`); // up to 85 px before
});

test("when zoomed out, vertices may stay outside the canvas", () => {
  // The user (2026-11-05): zoomed out, the graph could only be moved within the canvas rectangle.
  const [a, b] = [vertex(0, 300, 250), vertex(1, 500, 250)];
  const sim = createSimulation();
  const seen = { left: -800, top: -500, right: 1600, bottom: 1000 };
  captureRestState(sim, [a, b], [], CANVAS, seen);
  a.x = -300; // dragged out there
  b.dropped = true;
  [b.fx, b.fy] = [b.x, b.y];
  sim.alpha(START_ALPHA);
  for (let t = 0; t < 30; t++) sim.tick();
  assert.ok(a.x! < -100, `the vertex was pushed back to x = ${a.x!.toFixed(0)}`);
  // And the border follows the view.
  setBounds(sim, { left: 0, top: 0, right: 800, bottom: 500 });
  for (let t = 0; t < 30; t++) sim.tick();
  assert.ok(a.x! > -100, `the vertex stayed at x = ${a.x!.toFixed(0)}`);
});

test("force mode evens out edge lengths", () => {
  // The professor wanted force mode to keep making the drawing tidier, like Arrange little by little.
  const [a, b, c, d] = [vertex(0, 100, 250), vertex(1, 160, 250), vertex(2, 310, 250), vertex(3, 610, 250)];
  const links = [link(a, b), link(b, c), link(c, d)];
  settle([a, b, c, d], links);
  const lengths = links.map(lengthOf);
  assert.ok(Math.max(...lengths) / Math.min(...lengths) < 1.3, `edge lengths ${lengths.map((l) => l.toFixed(0))}`);
});

test("long labels get a bigger circle, short ones keep the default", () => {
  assert.equal(radiusForLabel(8), NODE_RADIUS);
  // "(0, 1)" in the 13px bold font is about 40px wide: it must fit inside the circle.
  assert.ok(radiusForLabel(40) * 2 > 40 + 8);
});

test("a vertex lying on an edge gets pushed off it", () => {
  // Regression: vertex 4 dropped on edge 3-2 made three edges overlap (found by testing).
  const [a, b, c, on] = [vertex(3, 100, 250), vertex(2, 500, 250), vertex(5, 300, 100), vertex(4, 300, 250)];
  const links = [link(a, b), link(a, on), link(on, b), link(c, on)];
  settle([a, b, c, on], links);
  assert.ok(distanceToEdge(on, links[0]) > NODE_RADIUS * 1.5, `vertex is only ${distanceToEdge(on, links[0]).toFixed(1)} px from the edge`);
});

// ---- Dragging (professor, 2026-11-05; docs/research/07-force-mode-feel.md) ----

test("a vertex dropped on another one ends with a clear gap", () => {
  const [a, b, c, d] = [vertex(0, 300, 250), vertex(1, 400, 250), vertex(2, 500, 250), vertex(3, 400, 400)];
  const vertices = [a, b, c, d];
  drag(simulation(vertices, [link(a, b), link(b, c)]), vertices, d, 400, 250);
  const gap = Math.hypot(d.x! - b.x!, d.y! - b.y!) - 2 * NODE_RADIUS;
  assert.ok(gap >= 20, `circles only ${gap.toFixed(1)} px apart`);
});

test("a vertex dropped on an edge ends clear of it", () => {
  const [a, b, d] = [vertex(0, 300, 250), vertex(1, 500, 250), vertex(2, 400, 400)];
  const edge = link(a, b);
  drag(simulation([a, b, d], [edge]), [a, b, d], d, 400, 252);
  assert.ok(distanceToEdge(d, edge) > NODE_RADIUS * 1.5, `vertex only ${distanceToEdge(d, edge).toFixed(1)} px from the edge`);
});

test("an edge moves out of the way of a vertex dragged slowly at it", () => {
  // As in CS Academy: a slow drag pushes the edge ahead instead of crossing it.
  const [a, b, d] = [vertex(0, 100, 250), vertex(1, 500, 250), vertex(2, 300, 350)];
  const edge = link(a, b);
  let closest = Infinity;
  drag(simulation([a, b, d], [edge]), [a, b, d], d, 300, 230, 40, 20, () => {
    closest = Math.min(closest, distanceToEdge(d, edge));
  });
  assert.ok(closest > NODE_RADIUS, `the edge came within ${closest.toFixed(1)} px of the vertex's centre`);
});

test("a quick move still gets a vertex across an edge", () => {
  const [a, b, d] = [vertex(0, 100, 250), vertex(1, 500, 250), vertex(2, 300, 350)];
  drag(simulation([a, b, d], [link(a, b)]), [a, b, d], d, 300, 120, 3, 10);
  const middle = (a.y! + b.y!) / 2;
  assert.ok(d.y! < middle - NODE_RADIUS, `vertex ended at ${d.y!.toFixed(0)}, the edge at ${middle.toFixed(0)}`);
});

test("dragging a vertex pulls the graph after it", () => {
  // CS Academy: dragging a vertex moves its neighbours partway after it, the rest less.
  const { vertices, links } = build(DRAWINGS.dodecahedron);
  const sim = settle(vertices, links);
  const byId = new Map(vertices.map((v) => [v.id, v]));
  const [dragged, neighbour, far] = [byId.get(0)!, byId.get(10)!, byId.get(13)!];
  const [x0, n0, f0] = [dragged.x!, neighbour.x!, far.x!];
  const target = CANVAS.width - NODE_RADIUS;
  let neighbourDuringDrag = 0;
  let farDuringDrag = 0;
  drag(sim, vertices, dragged, target, dragged.y!, 30, 60, () => {
    neighbourDuringDrag = neighbour.x! - n0;
    farDuringDrag = far.x! - f0;
  });
  const pulled = target - x0;
  assert.ok(neighbourDuringDrag > pulled / 2, `the neighbour only followed ${neighbourDuringDrag.toFixed(0)} px of ${pulled.toFixed(0)}`);
  assert.ok(farDuringDrag > pulled / 4, `the far side only followed ${farDuringDrag.toFixed(0)} px of ${pulled.toFixed(0)}`);
});

test("after a drop the vertex stays and the graph comes after it", () => {
  // The user's wish (2026-11-05): pull one vertex far, and the rest of the graph comes closer to it,
  // instead of staying stretched. Regression: earlier the dropped vertex was yanked back.
  const [a, b, c, end] = [vertex(0, 100, 250), vertex(1, 200, 250), vertex(2, 300, 250), vertex(3, 400, 250)];
  const vertices = [a, b, c, end];
  const links = [link(a, b), link(b, c), link(c, end)];
  const sim = settle(vertices, links);
  const length = Math.max(...links.map(lengthOf));
  // Pulled quickly far out along the path, and let go at once.
  const dropped = drag(sim, vertices, end, end.x! + 400, end.y!, 4, 1);
  assert.ok(Math.hypot(end.x! - dropped[0], end.y! - dropped[1]) < 1, "the dropped vertex moved");
  for (const l of links) assert.ok(lengthOf(l) < length * 1.3, `edge ${l.source.id}-${l.target.id} still stretched to ${lengthOf(l).toFixed(0)}`);
});

test("holding a vertex on an edge inside a graph doesn't make the graph shake", () => {
  // Regression: d3's repulsion stopped dead at its reach, so a vertex sitting at that distance was
  // pushed out, felt nothing, came back and was pushed out again, over and over.
  const { vertices, links } = build(DRAWINGS.dodecahedron);
  const sim = settle(vertices, links);
  const byId = new Map(vertices.map((v) => [v.id, v]));
  const [held, a, b] = [byId.get(0)!, byId.get(13)!, byId.get(14)!];
  const [x0, y0] = [held.x!, held.y!];
  const [x1, y1] = [(a.x! + b.x!) / 2, (a.y! + b.y!) / 2];
  startDrag(held, vertices);
  sim.alphaTarget(0.3).alpha(0.3);
  for (let i = 1; i <= 30; i++) {
    moveDrag(held, x0 + ((x1 - x0) * i) / 30, y0 + ((y1 - y0) * i) / 30);
    tick(sim);
  }
  for (let t = 0; t < 180; t++) tick(sim);
  // Over the next second, vertices may still settle, but not go back and forth.
  const before = vertices.map((v) => [v.x!, v.y!]);
  let path = 0;
  for (let t = 0; t < 60; t++) {
    const prev = vertices.map((v) => [v.x!, v.y!]);
    tick(sim);
    vertices.forEach((v, i) => (path += Math.hypot(v.x! - prev[i][0], v.y! - prev[i][1])));
  }
  const net = vertices.reduce((sum, v, i) => sum + Math.hypot(v.x! - before[i][0], v.y! - before[i][1]), 0);
  assert.ok(path < 1.5 * net + 10, `vertices moved ${path.toFixed(0)} px back and forth to get ${net.toFixed(0)} px further`);
});

test("physics doesn't hold a vertex back at an edge", () => {
  // The user (2026-11-26): don't try to keep the drawing's structure. Until then a crossing guard
  // (PrEd) stopped a vertex flung at an edge two radii short of it, and made all motion stiff.
  const [a, b, v] = [vertex(0, 100, 250), vertex(1, 500, 250), vertex(2, 300, 200)];
  a.fx = a.x;
  a.fy = a.y;
  b.fx = b.x;
  b.fy = b.y;
  const sim = createSimulation();
  refreshForces(sim, [a, b, v], [link(a, b)]);
  sim.alpha(START_ALPHA);
  for (let t = 0; t < 20; t++) {
    v.vy = 200; // flung at the edge every tick
    sim.tick();
  }
  assert.ok(v.y! > 250 + NODE_RADIUS, `the vertex stopped at y = ${v.y!.toFixed(1)}, the edge is at 250`);
});

// ---- Untangling (the user, 2026-11-25: physics may change the structure; research/07) ----

const closestToEdge = (vertices: Vertex[], links: Link[]) => {
  let closest = Infinity;
  for (const l of links) for (const v of vertices) if (v !== l.source && v !== l.target) closest = Math.min(closest, distanceToEdge(v, l));
  return closest;
};

// Force mode settled on a demo graph, then vertex `id` dragged onto the middle of edge a-b (and
// `past` px beyond it) in `steps` moves and dropped. `onTick` sees every tick after the drop.
function dropOnEdge(name: string, id: number, a: number, b: number, past: number, steps: number, onTick = (_: Vertex[]) => {}) {
  const { vertices, links } = build(DRAWINGS[name]);
  const sim = settle(vertices, links);
  const before = crossings(links);
  const byId = new Map(vertices.map((v) => [v.id, v]));
  const [v, ea, eb] = [byId.get(id)!, byId.get(a)!, byId.get(b)!];
  const [mx, my] = [(ea.x! + eb.x!) / 2, (ea.y! + eb.y!) / 2];
  const away = Math.hypot(mx - v.x!, my - v.y!);
  const [x, y] = [mx + ((mx - v.x!) / away) * past, my + ((my - v.y!) / away) * past];
  sim.alphaTarget(0.3).alpha(0.3);
  startDrag(v, vertices);
  const [x0, y0] = [v.x!, v.y!];
  for (let step = 1; step <= steps + 10; step++) {
    const k = Math.min(step, steps) / steps;
    moveDrag(v, x0 + (x - x0) * k, y0 + (y - y0) * k);
    tick(sim);
  }
  endDrag(v);
  sim.alphaTarget(0).alpha(DROP_ALPHA);
  while (sim.alpha() > sim.alphaMin()) {
    tick(sim);
    onTick(vertices);
  }
  releaseDropped(vertices);
  return { vertices, links, before };
}

for (const past of [0, 10, 40]) {
  test(`a vertex dropped onto an edge leaves no tangle (dodecahedron, ${past} px past the edge)`, () => {
    // The user's screenshot (2026-11-25): vertex 0 dropped on edge 9-10 sat on it, with edges
    // running through vertices. Physics kept that, or turned it into 2-3 crossings, for good.
    const { vertices, links } = dropOnEdge("dodecahedron", 0, 9, 10, past, 3);
    assert.equal(crossings(links), 0);
    const closest = closestToEdge(vertices, links);
    assert.ok(closest > NODE_RADIUS * 2, `a vertex is only ${closest.toFixed(0)} px from an edge`);
  });
}

test("crossings a drop made are taken away again (K5)", () => {
  // Found by dropping every vertex onto edges: this drop left K5 with 3 crossings instead of 1.
  const { links, before } = dropOnEdge("k5", 0, 1, 2, 30, 30);
  assert.equal(before, 1);
  assert.equal(crossings(links), 1);
});

test("untangling glides vertices to their new places instead of jumping", () => {
  let fastest = 0;
  let previous: number[][] = [];
  dropOnEdge("dodecahedron", 0, 9, 10, 10, 3, (vertices) => {
    vertices.forEach((v, i) => previous[i] && (fastest = Math.max(fastest, Math.hypot(v.x! - previous[i][0], v.y! - previous[i][1]))));
    previous = vertices.map((v) => [v.x!, v.y!]);
  });
  assert.ok(fastest < 30, `a vertex moved ${fastest.toFixed(0)} px in one tick`);
});

test("untangling never adds a crossing, and every hop takes one away or frees a vertex", () => {
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let round = 0; round < 30; round++) {
    const vertices = Array.from({ length: 12 }, (_, i) => vertex(i, 40 + random() * 720, 40 + random() * 420));
    const links: Link[] = [];
    for (let i = 0; i < 18; i++) {
      const [u, v] = [Math.floor(random() * 12), Math.floor(random() * 12)];
      if (u !== v) links.push(link(vertices[u], vertices[v]));
    }
    const nearMisses = () => {
      let count = 0;
      for (const l of links) for (const v of vertices) if (v !== l.source && v !== l.target && distanceToEdge(v, l) < NODE_RADIUS * 1.5) count++;
      for (const u of vertices) for (const v of vertices) if (u.id < v.id && Math.hypot(u.x! - v.x!, u.y! - v.y!) < u.r + v.r) count++;
      return count;
    };
    const [c0, n0] = [crossings(links), nearMisses()];
    const hops = untangle(vertices, links, 100, { left: 0, top: 0, right: 800, bottom: 500 });
    for (const [v, x, y] of hops) [v.x, v.y] = [x, y];
    const [c1, n1] = [crossings(links), nearMisses()];
    assert.ok(c1 <= c0, `round ${round}: crossings went from ${c0} to ${c1}`);
    if (hops.length > 0) assert.ok(c1 < c0 || n1 < n0, `round ${round}: ${hops.length} hops changed nothing`);
  }
});

test("a drawing with nothing to untangle stays as it is", () => {
  const { vertices, links } = build(DRAWINGS.dodecahedron);
  settle(vertices, links);
  assert.deepEqual(untangle(vertices, links, 100), []);
});

// ---- After Arrange for looks (docs/research/08) ----

for (const [id, x, y] of [[10, 400, 470], [5, 400, 30], [0, 760, 250]]) {
  test(`a drawing arranged for looks doesn't get squashed against the border (vertex ${id} dropped at ${x}, ${y})`, () => {
    // The user's screenshot (2026-11-26): shape memory (2026-11-23 to 26) moved the whole drawing
    // after a vertex dropped near the border, and the far side was squashed flat against it, with
    // vertices on edges. Now physics simply tidies the drawing from there.
    const { vertices, links } = build(looksFixture as unknown as Drawing);
    const sim = simulation(vertices, links);
    sim.alpha(0); // what the widget does after Arrange for looks: nothing moves until a touch
    drag(sim, vertices, vertices.find((v) => v.id === id)!, x, y);
    assert.equal(crossings(links), 0);
    assert.ok(closestToEdge(vertices, links) > NODE_RADIUS * 2, "a vertex is left close to an edge");
    const pressed = vertices.filter((v) => Math.min(v.x! - v.r, v.y! - v.r, CANVAS.width - v.r - v.x!, CANVAS.height - v.r - v.y!) < 2);
    assert.deepEqual(pressed.map((v) => v.id), [], "vertices pressed against the border");
  });
}

// The carpet graph of main.ipynb, circulant C24(1, 5, 7, 11), as Arrange for looks draws it: a
// dense graph with hundreds of crossings.
function carpet(): { vertices: Vertex[]; links: Link[] } {
  const vertices = Array.from({ length: 24 }, (_, i) =>
    vertex(i, 400 + 220 * Math.cos((2 * Math.PI * i) / 24), 250 + 220 * Math.sin((2 * Math.PI * i) / 24)),
  );
  const links: Link[] = [];
  for (let i = 0; i < 24; i++) for (const step of [1, 5, 7, 11]) links.push(link(vertices[i], vertices[(i + step) % 24]));
  return { vertices, links };
}

test("a dense graph touched after Arrange for looks moves smoothly instead of shaking", () => {
  // The user (2026-11-26): the carpet jerked wildly when touched. Pushes off dozens of edges
  // added up: vertices flew up to 330 px in one tick and shook back and forth for 3 seconds, and
  // single-vertex untangling hopped vertices around for 10 more.
  const { vertices, links } = carpet();
  const sim = simulation(vertices, links);
  sim.alpha(0);
  let fastest = 0;
  let previous = vertices.map((v) => [v.x!, v.y!]);
  const second: { path: number; start: number[][] } = { path: 0, start: [] };
  let ticks = 0;
  const watch = () => {
    ticks++;
    vertices.forEach((v, i) => {
      const step = Math.hypot(v.x! - previous[i][0], v.y! - previous[i][1]);
      fastest = Math.max(fastest, step);
      if (ticks > 60 && ticks <= 120) second.path += step;
    });
    if (ticks === 60) second.start = vertices.map((v) => [v.x!, v.y!]);
    previous = vertices.map((v) => [v.x!, v.y!]);
    assert.ok(!vertices.some((v) => v.hopping), `a vertex hopped at tick ${ticks}`);
  };
  drag(sim, vertices, vertices[0], vertices[0].x! + 5, vertices[0].y!, 5, 15, watch, watch);
  assert.ok(fastest <= NODE_RADIUS + 1e-6, `a vertex moved ${fastest.toFixed(0)} px in one tick`);
  // In the second second after the grab: vertices go somewhere, not back and forth.
  const net = vertices.reduce((sum, v, i) => sum + Math.hypot(v.x! - second.start[i][0], v.y! - second.start[i][1]), 0);
  assert.ok(ticks > 120, "the physics stopped too early to measure");
  assert.ok(second.path < 1.5 * net + 10, `vertices moved ${second.path.toFixed(0)} px back and forth to get ${net.toFixed(0)} px further`);
});

test("untangling leaves a graph alone that is a tangle by nature", () => {
  const { vertices, links } = carpet();
  assert.deepEqual(untangle(vertices, links, 100), []);
});
