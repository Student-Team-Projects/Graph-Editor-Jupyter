import assert from "node:assert/strict";
import { test } from "node:test";
import { edgeId, idOfNode, nodeId, toElements, type ModelNode, type Paint } from "./elements";

const at = () => ({ x: 1, y: 2 });
const radius = ({ label, size }: ModelNode) => Math.max(10 + label.length, (size ?? 0) / 2);
const edge = (u: number, v: number, look = {}) => ({ u, v, ...look });
const dataOf = (elements: ReturnType<typeof toElements>, id: string) => elements.find((e) => e.data.id === id)!.data;

test("undirected edge ids ignore direction, directed ones don't", () => {
  assert.equal(edgeId(3, 7), edgeId(7, 3));
  assert.notEqual(edgeId(3, 7), edgeId(3, 8));
  assert.notEqual(edgeId(3, 7, true), edgeId(7, 3, true));
  assert.notEqual(edgeId(3, 7, true), edgeId(3, 7));
});

test("node ids round-trip", () => {
  assert.equal(idOfNode(nodeId(42)), 42);
});

test("elements include vertices, edges and self-loops", () => {
  const elements = toElements([{ id: 0, label: "a" }, { id: 1, label: "(0, 1)" }], [edge(0, 1), edge(1, 1)], false, at, radius);
  assert.deepEqual(elements.map((e) => e.data.id), ["n0", "n1", "e0-1", "e1-1"]);
  const loop = dataOf(elements, "e1-1");
  assert.equal(loop.source, loop.target);
  // Long labels get bigger vertices.
  assert.ok(elements[1].data.size > elements[0].data.size);
});

test("edges to unknown vertices and duplicates are dropped", () => {
  const elements = toElements([{ id: 0, label: "a" }, { id: 1, label: "b" }], [edge(0, 1), edge(1, 0), edge(0, 9)], false, at, radius);
  assert.deepEqual(elements.filter((e) => e.group === "edges").map((e) => e.data.id), ["e0-1"]);
});

// ---- the look from the graph's attributes (the user, 2026-11-26) ----

const paint: Paint = (color) => (color === "nonsense" ? null : { fill: `#${color}`, text: "#ffffff" });

test("a vertex gets its label, color, readable text color and size", () => {
  const elements = toElements([{ id: 0, label: "Kraków", color: "123456", size: 80 }, { id: 1, label: "b" }], [], false, at, radius, paint);
  assert.deepEqual(dataOf(elements, "n0"), { id: "n0", label: "Kraków", size: 80, color: "#123456", textColor: "#ffffff" });
  // No attributes: the default look, nothing extra in the data.
  assert.deepEqual(Object.keys(dataOf(elements, "n1")).sort(), ["id", "label", "size"]);
});

test("a size smaller than the label needs is overruled by the label", () => {
  const elements = toElements([{ id: 0, label: "a long label", size: 4 }], [], false, at, radius);
  assert.equal(elements[0].data.size, 2 * (10 + "a long label".length));
});

test("an edge gets its weight as a label, its color and its width", () => {
  const elements = toElements([{ id: 0, label: "a" }, { id: 1, label: "b" }], [edge(0, 1, { label: "2.5", color: "ff0000", width: 6 })], false, at, radius, paint);
  assert.deepEqual(dataOf(elements, "e0-1"), { id: "e0-1", source: "n0", target: "n1", label: "2.5", color: "#ff0000", width: 6 });
});

test("colors the browser doesn't know and empty labels are left out", () => {
  const elements = toElements(
    [{ id: 0, label: "a", color: "nonsense" }, { id: 1, label: "b" }],
    [edge(0, 1, { label: "", color: "nonsense", width: 0 })],
    false, at, radius, paint,
  );
  assert.equal(dataOf(elements, "n0").color, undefined);
  assert.deepEqual(Object.keys(dataOf(elements, "e0-1")).sort(), ["id", "source", "target"]);
});

test("a directed graph gets arrows, and u -> v and v -> u are two edges", () => {
  const elements = toElements([{ id: 0, label: "a" }, { id: 1, label: "b" }], [edge(0, 1), edge(1, 0)], true, at, radius);
  const edges = elements.filter((e) => e.group === "edges").map((e) => e.data);
  assert.deepEqual(edges.map((d) => [d.id, d.source, d.target, d.arrow]), [
    ["e0>1", "n0", "n1", true],
    ["e1>0", "n1", "n0", true],
  ]);
});

test("an undirected graph has no arrows", () => {
  const elements = toElements([{ id: 0, label: "a" }, { id: 1, label: "b" }], [edge(0, 1)], false, at, radius);
  assert.equal(dataOf(elements, "e0-1").arrow, undefined);
});
