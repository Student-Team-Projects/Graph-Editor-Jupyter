import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clickVertex,
  easeInOut,
  HELP,
  hint,
  isRepeatClick,
  keyAction,
  REPEAT_CLICK_MS,
  wheelZoomFactor,
  type Selection,
} from "./interaction";

const noEdges = () => false;
const key = (k: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) => ({
  key: k,
  ctrlKey: mods.ctrl ?? false,
  metaKey: mods.meta ?? false,
  shiftKey: mods.shift ?? false,
});

test("click two vertices adds an edge and moves the selection on", () => {
  const first = clickVertex(null, 1, noEdges);
  assert.deepEqual(first, { selection: { kind: "vertex", id: 1 } });
  const second = clickVertex(first.selection, 2, noEdges);
  assert.deepEqual(second, { selection: { kind: "vertex", id: 2 }, addEdge: [1, 2] });
});

test("no duplicate edge, and clicking the selected vertex deselects", () => {
  const sel: Selection = { kind: "vertex", id: 1 };
  assert.equal(clickVertex(sel, 2, () => true).addEdge, undefined);
  assert.deepEqual(clickVertex(sel, 1, noEdges), { selection: null });
});

// Regression: double-clicking vertex B with A selected added edge A-B and then deleted B.
// A double click is now just two clicks: the edge stays, nothing is removed.
test("a double click is two clicks and removes nothing", () => {
  const a: Selection = { kind: "vertex", id: 1 };
  const once = clickVertex(a, 2, noEdges);
  const twice = clickVertex(once.selection, 2, () => true);
  assert.deepEqual(once.addEdge, [1, 2]);
  assert.deepEqual(twice, { selection: null });
  assert.ok(!HELP.toLowerCase().includes("double"));
});

// Regression: adding a vertex waited 250 ms for Cytoscape's double-click check. Clicks are
// now handled at once, so the second click of a double click must not add another vertex.
test("second click of a double click is ignored, later or distant clicks are not", () => {
  const add = { x: 100, y: 100, time: 1000 };
  assert.ok(isRepeatClick(add, { x: 103, y: 101, time: 1200 }));
  assert.ok(!isRepeatClick(add, { x: 103, y: 101, time: 1000 + REPEAT_CLICK_MS + 1 }));
  assert.ok(!isRepeatClick(add, { x: 160, y: 100, time: 1100 }));
  assert.ok(!isRepeatClick(null, add));
});

test("undo and redo shortcuts, also with Cmd", () => {
  assert.equal(keyAction(key("z", { ctrl: true }), null), "undo");
  assert.equal(keyAction(key("z", { meta: true }), null), "undo");
  assert.equal(keyAction(key("Z", { ctrl: true, shift: true }), null), "redo");
  assert.equal(keyAction(key("y", { ctrl: true }), null), "redo");
});

test("Delete removes only with a selection; other keys pass through", () => {
  const sel: Selection = { kind: "edge", u: 1, v: 2 };
  assert.equal(keyAction(key("Delete"), sel), "remove");
  assert.equal(keyAction(key("Backspace"), sel), "remove");
  assert.equal(keyAction(key("Delete"), null), null);
  assert.equal(keyAction(key("Escape"), sel), "deselect");
  assert.equal(keyAction(key("c", { ctrl: true }), sel), null); // copy stays the browser's
  assert.equal(keyAction(key("a"), sel), null);
});

test("hint says what the next click does", () => {
  assert.equal(hint(null), HELP);
  assert.match(hint({ kind: "vertex", id: 1 }), /connect/);
  assert.match(hint({ kind: "edge", u: 1, v: 2 }), /remove edge/);
});

test("glide starts slow, ends exactly at the target, and never overshoots", () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(easeInOut(0.5), 0.5);
  assert.ok(easeInOut(0.1) < 0.1);
  assert.equal(easeInOut(2), 1);
  for (let t = 0; t <= 1; t += 0.05) assert.ok(easeInOut(t) >= 0 && easeInOut(t) <= 1);
});

test("wheel zoom: up zooms in, down zooms out, big jumps are limited", () => {
  assert.ok(wheelZoomFactor(-100, 0) > 1);
  assert.ok(wheelZoomFactor(100, 0) < 1);
  assert.equal(wheelZoomFactor(0, 0), 1);
  assert.equal(wheelZoomFactor(10_000, 0), wheelZoomFactor(100, 0));
  assert.equal(wheelZoomFactor(3, 1), wheelZoomFactor(48, 0)); // line mode
});
