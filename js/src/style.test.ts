import assert from "node:assert/strict";
import { test } from "node:test";
import { graphStyle } from "./style";

const colors = { ink: "#000", paper: "#fff", accent: "#00f", accentSoft: "#ccf" };

function styleOf(selector: string): Record<string, unknown> {
  const rules = graphStyle(colors) as { selector: string; style: Record<string, unknown> }[];
  const rule = rules.find((r) => r.selector === selector);
  assert.ok(rule, `no rule for ${selector}`);
  return rule.style;
}

// Regression: Cytoscape's default press feedback showed a grey square over vertices and a
// grey circle on the empty canvas.
test("no default press overlays", () => {
  assert.equal(styleOf("core")["active-bg-opacity"], 0);
  assert.equal(styleOf("node")["overlay-opacity"], 0);
  assert.equal(styleOf("edge")["overlay-opacity"], 0);
});

test("selection uses the accent colour", () => {
  assert.equal(styleOf("node.ge-selected")["border-color"], colors.accent);
  assert.equal(styleOf("edge.ge-selected")["line-color"], colors.accent);
});
