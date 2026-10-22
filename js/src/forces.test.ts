import assert from "node:assert/strict";
import { test } from "node:test";
import fixture from "../test/dodecahedron.json";
import {
  captureRestState,
  createSimulation,
  NODE_RADIUS,
  radiusForLabel,
  rehome,
  START_ALPHA,
  type Link,
  type Vertex,
} from "./forces";

function load(): { vertices: Vertex[]; links: Link[] } {
  const byId = new Map<number, Vertex>();
  for (const [id, x, y] of fixture.nodes) byId.set(id, { id, label: String(id), r: NODE_RADIUS, x, y, homeX: x, homeY: y });
  const links = fixture.edges.map(([u, v]) => ({ source: byId.get(u)!, target: byId.get(v)!, rest: 0 }));
  return { vertices: [...byId.values()], links };
}

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

function settle(vertices: Vertex[], links: Link[]): ReturnType<typeof createSimulation> {
  const sim = createSimulation();
  captureRestState(sim, vertices, links);
  sim.alpha(START_ALPHA);
  for (let t = 0; t < 300; t++) sim.tick();
  return sim;
}

test("turning force on keeps a crossing-free layout almost unchanged", () => {
  const { vertices, links } = load();
  assert.equal(crossings(links), 0);
  const start = vertices.map((v) => [v.x!, v.y!]);
  settle(vertices, links);
  assert.equal(crossings(links), 0);
  const moved = Math.max(...vertices.map((v, i) => Math.hypot(v.x! - start[i][0], v.y! - start[i][1])));
  assert.ok(moved < 40, `vertices moved up to ${moved.toFixed(1)} px`);
});

test("vertices pushed aside by a drag spring back", () => {
  const { vertices, links } = load();
  const sim = settle(vertices, links);
  const [dragged, neighbour] = [links[0].source, links[0].target];
  const home = [neighbour.x!, neighbour.y!];

  // Hold the dragged vertex on top of its neighbour for a while.
  dragged.fx = neighbour.x;
  dragged.fy = neighbour.y;
  sim.alphaTarget(0.3);
  for (let t = 0; t < 60; t++) sim.tick();
  const pushed = Math.hypot(neighbour.x! - home[0], neighbour.y! - home[1]);
  assert.ok(pushed > NODE_RADIUS, `neighbour only moved ${pushed.toFixed(1)} px`);

  // Release the dragged vertex far away; the neighbour returns close to home.
  dragged.fx = dragged.fy = null;
  dragged.x = 60;
  dragged.y = 60;
  rehome(sim, dragged, vertices, links);
  sim.alphaTarget(0).alpha(START_ALPHA);
  for (let t = 0; t < 400; t++) sim.tick();
  const back = Math.hypot(neighbour.x! - home[0], neighbour.y! - home[1]);
  assert.ok(back < pushed, `neighbour ended ${back.toFixed(1)} px from home, was pushed ${pushed.toFixed(1)} px`);
});

test("long labels get a bigger circle, short ones keep the default", () => {
  assert.equal(radiusForLabel(8), NODE_RADIUS);
  // "(0, 1)" in the 13px bold font is about 40px wide: it must fit inside the circle.
  assert.ok(radiusForLabel(40) * 2 > 40 + 8);
});

test("a vertex lying on an edge gets pushed off it", () => {
  // Regression: vertex 4 dropped on edge 3-2 made three edges overlap (found by testing).
  const v = (id: number, x: number, y: number): Vertex => ({ id, label: String(id), r: NODE_RADIUS, x, y, homeX: x, homeY: y });
  const [a, b, c, on] = [v(3, 100, 250), v(2, 500, 250), v(5, 300, 100), v(4, 300, 250)];
  const vertices = [a, b, c, on];
  const links: Link[] = [
    { source: a, target: b, rest: 0 },
    { source: a, target: on, rest: 0 },
    { source: on, target: b, rest: 0 },
    { source: c, target: on, rest: 0 },
  ];
  const sim = settle(vertices, links);
  sim.stop();
  const t = Math.max(0, Math.min(1, (on.x! - a.x!) / (b.x! - a.x!)));
  const gap = Math.hypot(on.x! - (a.x! + t * (b.x! - a.x!)), on.y! - (a.y! + t * (b.y! - a.y!)));
  assert.ok(gap > NODE_RADIUS * 1.5, `vertex is only ${gap.toFixed(1)} px from the edge`);
});
