import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { forgetPageOffset } from "./pageOffset";

// Regression: after the notebook scrolled, clicks missed (the graph only responded after
// toggling force). The cached canvas position must be dropped.
test("clears Cytoscape's cached canvas position", () => {
  let cleared = 0;
  let resized = 0;
  forgetPageOffset({
    resize: () => resized++,
    renderer: () => ({ invalidateContainerClientCoordsCache: () => cleared++ }),
  });
  assert.equal(cleared, 1);
  assert.equal(resized, 0);
});

test("falls back to resize if the internal method is gone", () => {
  let resized = 0;
  forgetPageOffset({ resize: () => resized++, renderer: () => ({}) });
  forgetPageOffset({ resize: () => resized++ });
  assert.equal(resized, 2);
});

test("the installed Cytoscape still has the internal method", () => {
  const source = readFileSync("node_modules/cytoscape/dist/cytoscape.esm.mjs", "utf8");
  assert.ok(source.includes("invalidateContainerClientCoordsCache = function"));
});
