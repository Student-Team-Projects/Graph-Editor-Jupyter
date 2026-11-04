import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// Regression: clicking Undo quickly selected the word "Undo" (a double-click selects text).
test("toolbar text can't be selected by fast clicks", () => {
  const css = readFileSync("src/widget.css", "utf8");
  const toolbar = css.match(/\.ge-toolbar \{([^}]*)\}/);
  assert.ok(toolbar, "no .ge-toolbar rule");
  assert.match(toolbar[1], /(^|[^-])user-select: none/);
  assert.match(toolbar[1], /-webkit-user-select: none/); // Safari
});

// Regression: with a fixed height a narrow canvas showed empty strips, and clicks there landed
// outside the drawing area. And the 100% width pushed the right border out of the notebook.
test("a narrow canvas keeps its shape and its border", () => {
  const source = readFileSync("src/widget.ts", "utf8");
  assert.match(source, /style\.aspectRatio/);
  assert.doesNotMatch(source, /container\.style\.height/);
  const css = readFileSync("src/widget.css", "utf8");
  assert.match(css, /max-width: calc\(100% - 2px\)/);
});

// Regression: the hint sat in the toolbar, so when its length changed on selection the toolbar
// resized and the whole canvas jumped under the pointer.
test("the hint is below the canvas, so its length can't move it", () => {
  const widget = readFileSync("src/widget.ts", "utf8");
  assert.match(widget, /el\.append\(toolbar, this\.container, this\.help\)/);
  assert.doesNotMatch(widget, /toolbar\.append\([^)]*this\.help/);
});
