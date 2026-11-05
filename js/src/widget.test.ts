import assert from "node:assert/strict";
import { test } from "node:test";
import { GraphEditor } from "./widget";
import { Glide } from "./glide";
import { createSimulation, NODE_RADIUS, type Vertex } from "./forces";
import { nodeId } from "./elements";
import { MOVE_MS } from "./interaction";

test("a frozen-mode drop during a glide survives subsequent animation frames", () => {
  let id = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const glide = new Glide(
    (callback) => { pending.set(++id, callback); return id; },
    (frame) => { pending.delete(frame); },
    () => 0,
  );
  const tick = (time: number) => {
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((callback) => callback(time));
  };
  const vertex: Vertex = { id: 0, label: "0", r: NODE_RADIUS, x: 300, y: 100 };
  const handlers = new Map<string, (event?: any) => void>();
  const sent: unknown[] = [];
  // Exercise the actual graph event handlers without constructing a browser canvas.
  const editor = Object.create(GraphEditor.prototype);
  Object.assign(editor, {
    cy: { on: (name: string, selector: any, handler?: any) => handlers.set(name, handler ?? selector) },
    vertices: new Map([[0, vertex]]), links: [], glide, force: false,
    simulation: createSimulation(),
    model: { get: () => 500, set: () => {}, save_changes: () => {}, send: (message: unknown) => sent.push(message) },
    updatePreview: () => {}, updatePositions: () => {},
  });
  editor.bindGraphEvents();
  glide.start((t) => { vertex.x = 300 - 100 * t; }, () => editor.finishGlide(false));
  tick(MOVE_MS * 0.2);
  assert.equal(vertex.x, 280);
  handlers.get("grab")!();
  const node = { id: () => nodeId(0), position: () => ({ x: 150, y: 130 }) };
  handlers.get("drag")!({ target: node });
  handlers.get("free")!({ target: node });
  tick(MOVE_MS * 0.5);
  tick(MOVE_MS);
  glide.finish(); // no latent destination may reappear on a later history operation
  assert.equal(vertex.x, 150);
  assert.equal(vertex.y, 130);
  assert.equal(pending.size, 0);
  assert.equal(sent.length, 1);
  editor.simulation.stop();
});

test("in force mode the dragged vertex is held under the pointer, then dropped where it is", () => {
  const v = (id: number, x: number, y: number): Vertex => ({ id, label: String(id), r: NODE_RADIUS, x, y });
  const [a, d] = [v(0, 100, 100), v(2, 300, 330)];
  const handlers = new Map<string, (event?: any) => void>();
  const editor = Object.create(GraphEditor.prototype);
  Object.assign(editor, {
    cy: { on: (name: string, selector: any, handler?: any) => handlers.set(name, handler ?? selector) },
    vertices: new Map([[0, a], [2, d]]), links: [], glide: new Glide(() => 0, () => {}, () => 0), force: true,
    simulation: createSimulation(),
    model: { get: () => 500, set: () => {}, save_changes: () => {}, send: () => {} },
    updatePreview: () => {}, updatePositions: () => {},
  });
  editor.simulation.nodes([a, d]);
  editor.bindGraphEvents();
  let drawn = { x: 300, y: 330 };
  const node = { id: () => nodeId(2), position: (to?: { x: number; y: number }) => (to ? (drawn = { ...to }) : drawn) };
  handlers.get("grab")!({ target: node });
  drawn = { x: 360, y: 250 };
  handlers.get("drag")!({ target: node });
  assert.deepEqual([d.x, d.y, d.fx, d.fy], [360, 250, 360, 250]);
  drawn = { x: 900, y: 250 }; // past the canvas: the vertex stays on it
  handlers.get("drag")!({ target: node });
  assert.deepEqual([d.x, d.fx], [500 - NODE_RADIUS, 500 - NODE_RADIUS]);
  handlers.get("free")!({ target: node });
  // Dropped: stays pinned where it was dropped while the graph comes after it.
  assert.equal(d.dragged, false);
  assert.equal(d.dropped, true);
  assert.deepEqual([d.fx, d.fy], [500 - NODE_RADIUS, 250]);
  editor.simulation.stop();
});

test("the editor opens with the drawing already tidied, and physics cooled down", () => {
  // Regression: the first layout was shown and force mode then moved every vertex, which looked
  // like a jump; and the simulation was left at alpha 1, so the first grab moved the whole graph.
  const v = (id: number, x: number, y: number): Vertex => ({ id, label: String(id), r: NODE_RADIUS, x, y });
  const vertices = [v(0, 100, 250), v(1, 160, 250), v(2, 310, 250), v(3, 610, 250)];
  const links = [0, 1, 2].map((i) => ({ source: vertices[i], target: vertices[i + 1] }));
  const editor = Object.create(GraphEditor.prototype);
  Object.assign(editor, {
    vertices: new Map(vertices.map((x) => [x.id, x])), links, simulation: createSimulation(),
    forceButton: { setAttribute: () => {} },
    model: { get: (key: string) => (key === "width" ? 800 : 500), set: () => {}, save_changes: () => {} },
    updatePositions: () => {},
  });
  editor.setForce(true, true);
  const lengths = links.map(({ source, target }) => Math.hypot(source.x! - target.x!, source.y! - target.y!));
  assert.ok(Math.max(...lengths) / Math.min(...lengths) < 1.3, `edges ${lengths.map((l) => l.toFixed(0))} not tidied yet`);
  assert.equal(editor.simulation.alpha(), 0);
  editor.simulation.stop();
});

test("zoomed out, a vertex can be dragged past the canvas", () => {
  // The user (2026-11-05): zoomed out, vertices still stopped at the canvas rectangle.
  const d: Vertex = { id: 2, label: "2", r: NODE_RADIUS, x: 300, y: 330 };
  const handlers = new Map<string, (event?: any) => void>();
  const editor = Object.create(GraphEditor.prototype);
  Object.assign(editor, {
    cy: {
      on: (name: string, selector: any, handler?: any) => handlers.set(name, handler ?? selector),
      extent: () => ({ x1: -400, y1: -250, x2: 1200, y2: 750 }), // zoomed out to half
    },
    container: { clientWidth: 800 },
    vertices: new Map([[2, d]]), links: [], glide: new Glide(() => 0, () => {}, () => 0), force: false,
    simulation: createSimulation(),
    model: { get: () => 500, set: () => {}, save_changes: () => {}, send: () => {} },
    updatePreview: () => {}, updatePositions: () => {},
  });
  editor.bindGraphEvents();
  let drawn = { x: 300, y: 330 };
  const node = { id: () => nodeId(2), position: (to?: { x: number; y: number }) => (to ? (drawn = { ...to }) : drawn) };
  handlers.get("grab")!({ target: node });
  drawn = { x: -200, y: 330 };
  handlers.get("drag")!({ target: node });
  handlers.get("free")!({ target: node });
  assert.equal(d.x, -200);
  editor.simulation.stop();
});

test("scrolling or zooming the view doesn't move vertices", () => {
  // The user (2026-11-05): the border followed the view, so scrolling down or zooming in pushed
  // vertices that were past the canvas along with it.
  const d: Vertex = { id: 2, label: "2", r: NODE_RADIUS, x: 300, y: 330 };
  const handlers = new Map<string, (event?: any) => void>();
  let seen = { x1: -400, y1: -250, x2: 1200, y2: 750 }; // zoomed out to half
  const editor = Object.create(GraphEditor.prototype);
  Object.assign(editor, {
    cy: { on: (name: string, selector: any, handler?: any) => handlers.set(name, handler ?? selector), extent: () => seen },
    container: { clientWidth: 800 },
    vertices: new Map([[2, d]]), links: [], glide: new Glide(() => 0, () => {}, () => 0), force: true,
    simulation: createSimulation(),
    model: { get: () => 500, set: () => {}, save_changes: () => {}, send: () => {} },
    updatePreview: () => {}, updatePositions: () => {},
  });
  editor.simulation.nodes([d]);
  editor.bindGraphEvents();
  let drawn = { x: 300, y: 330 };
  const node = { id: () => nodeId(2), position: (to?: { x: number; y: number }) => (to ? (drawn = { ...to }) : drawn) };
  handlers.get("grab")!({ target: node });
  drawn = { x: -200, y: 700 };
  handlers.get("drag")!({ target: node });
  handlers.get("free")!({ target: node });
  editor.simulation.stop();
  seen = { x1: 0, y1: 0, x2: 800, y2: 500 }; // zoomed back in: the vertex is out of view now
  handlers.get("viewport")?.();
  for (let t = 0; t < 30; t++) {
    editor.simulation.tick();
    editor.onTick();
  }
  assert.ok(Math.hypot(d.x! + 200, d.y! - 700) < 1, `the vertex moved to ${d.x!.toFixed(0)}, ${d.y!.toFixed(0)}`);
});

test("dragging a vertex around doesn't let the rest of the graph walk past the border", () => {
  // Regression: during a drag the room physics keeps vertices in was worked out from every vertex,
  // with a margin, on every pointer move, so a vertex physics pushed against the border took the
  // border along (the user, 2026-11-05: the tree went past the canvas).
  const [a, d]: Vertex[] = [
    { id: 0, label: "0", r: NODE_RADIUS, x: 400, y: 20 }, // where the first layout puts the top vertex
    { id: 2, label: "2", r: NODE_RADIUS, x: 300, y: 330 },
  ];
  const handlers = new Map<string, (event?: any) => void>();
  const editor = Object.create(GraphEditor.prototype);
  Object.assign(editor, {
    cy: { on: (name: string, selector: any, handler?: any) => handlers.set(name, handler ?? selector), extent: () => ({ x1: 0, y1: 0, x2: 800, y2: 500 }) },
    container: { clientWidth: 800 },
    vertices: new Map([[0, a], [2, d]]), links: [], glide: new Glide(() => 0, () => {}, () => 0), force: true,
    simulation: createSimulation(),
    model: { get: (key: string) => (key === "width" ? 800 : 500), set: () => {}, save_changes: () => {}, send: () => {} },
    updatePreview: () => {}, updatePositions: () => {},
  });
  editor.simulation.nodes([a, d]);
  editor.updateRoom();
  editor.bindGraphEvents();
  let drawn = { x: 300, y: 330 };
  const node = { id: () => nodeId(2), position: (to?: { x: number; y: number }) => (to ? (drawn = { ...to }) : drawn) };
  handlers.get("grab")!({ target: node });
  for (let step = 0; step < 50; step++) {
    drawn = { x: 300 + (step % 2) * 5, y: 330 };
    handlers.get("drag")!({ target: node });
    a.vy = -40; // something keeps pushing it up, like a child dragged above its parent
    editor.simulation.tick();
    editor.onTick();
  }
  handlers.get("free")!({ target: node });
  editor.simulation.stop();
  assert.ok(a.y! >= NODE_RADIUS, `the vertex went up to y = ${a.y!.toFixed(0)}`);
});

test("Arrange moves the view so the redrawn graph is in the middle of it", () => {
  const pending = new Map<number, FrameRequestCallback>();
  let id = 0;
  const glide = new Glide((callback) => { pending.set(++id, callback); return id; }, (frame) => { pending.delete(frame); }, () => 0);
  const tick = (time: number) => {
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((callback) => callback(time));
  };
  const v = (vid: number, x: number, y: number): Vertex => ({ id: vid, label: String(vid), r: NODE_RADIUS, x, y });
  const vertices = [v(0, 100, 100), v(1, 200, 100)];
  let pan = { x: -300, y: 40 }; // scrolled somewhere else, zoomed out to half
  const editor = Object.create(GraphEditor.prototype);
  Object.assign(editor, {
    cy: {
      pan: (to?: { x: number; y: number }) => (to ? void (pan = { ...to }) : { ...pan }),
      zoom: () => 0.5, width: () => 800, height: () => 500,
      getElementById: () => ({ grabbed: () => false }),
    },
    vertices: new Map(vertices.map((x) => [x.id, x])), links: [], glide, force: false,
    simulation: createSimulation(),
    arrangeButton: {},
    model: { get: (key: string) => (key === "width" ? 800 : 500), set: () => {}, save_changes: () => {}, send: () => {} },
    updatePreview: () => {}, updatePositions: () => {},
  });
  // Python's new layout, normalized: (0, 0) and (1, 1) are 20 px in from the canvas corners.
  editor.onCustomMessage({ type: "set_positions", positions: { 0: [0, 0], 1: [1, 1] }, settle: true });
  tick(0);
  tick(MOVE_MS * 2);
  // The new drawing's middle, (400, 250), is drawn in the middle of the 800 x 500 view.
  assert.deepEqual([400 * 0.5 + pan.x, 250 * 0.5 + pan.y], [400, 250]);
  editor.simulation.stop();
});
