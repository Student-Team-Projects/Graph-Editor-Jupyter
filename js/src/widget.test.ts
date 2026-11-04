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
  const vertex: Vertex = { id: 0, label: "0", r: NODE_RADIUS, x: 300, y: 100, homeX: 300, homeY: 100 };
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
