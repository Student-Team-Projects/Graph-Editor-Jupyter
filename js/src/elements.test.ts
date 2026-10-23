import assert from "node:assert/strict";
import { test } from "node:test";
import { edgeId, idOfNode, nodeId, toElements } from "./elements";

const at = () => ({ x: 1, y: 2 });
const radius = (label: string) => 10 + label.length;

test("edge ids ignore direction", () => {
  assert.equal(edgeId(3, 7), edgeId(7, 3));
  assert.notEqual(edgeId(3, 7), edgeId(3, 8));
});

test("node ids round-trip", () => {
  assert.equal(idOfNode(nodeId(42)), 42);
});

test("elements include vertices, edges and self-loops", () => {
  const elements = toElements(
    [
      { id: 0, label: "a" },
      { id: 1, label: "(0, 1)" },
    ],
    [
      [0, 1],
      [1, 1],
    ],
    at,
    radius,
  );
  const ids = elements.map((e) => e.data.id);
  assert.deepEqual(ids, ["n0", "n1", "e0-1", "e1-1"]);
  const loop = elements.find((e) => e.data.id === "e1-1")!;
  assert.equal(loop.data.source, loop.data.target);
  // Long labels get bigger vertices.
  assert.ok(elements[1].data.size > elements[0].data.size);
});

test("edges to unknown vertices and duplicates are dropped", () => {
  const elements = toElements(
    [{ id: 0, label: "a" }, { id: 1, label: "b" }],
    [
      [0, 1],
      [1, 0],
      [0, 9],
    ],
    at,
    radius,
  );
  assert.deepEqual(
    elements.filter((e) => e.group === "edges").map((e) => e.data.id),
    ["e0-1"],
  );
});
