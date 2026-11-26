import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { graphStyle, readableText } from "./style";

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

// ---- the look from the graph's attributes (the user, 2026-11-26) ----

const rules = () => graphStyle(colors) as { selector: string; style: Record<string, unknown> }[];

test("attribute rules draw colors, sizes, weights and arrows", () => {
  assert.equal(styleOf("node[color]")["background-color"], "data(color)");
  assert.equal(styleOf("node[textColor]").color, "data(textColor)");
  assert.equal(styleOf("edge[color]")["line-color"], "data(color)");
  assert.equal(styleOf("edge[color]")["target-arrow-color"], "data(color)");
  assert.equal(styleOf("edge[width]").width, "data(width)");
  assert.equal(styleOf("edge[label]").label, "data(label)");
  assert.equal(styleOf("edge[?arrow]")["target-arrow-shape"], "triangle");
  assert.equal(styleOf("node").width, "data(size)");
});

test("the weight on an edge sits on a patch of paper", () => {
  assert.equal(styleOf("edge[label]")["text-background-color"], colors.paper);
  assert.equal(styleOf("edge[label]")["text-background-opacity"], 1);
});

test("selection still shows on colored vertices and edges", () => {
  // Later rules win in Cytoscape: selection must come after the attribute rules.
  const order = rules().map((r) => r.selector);
  for (const attribute of ["node[color]", "node[textColor]", "edge[color]", "edge[width]"]) {
    const selected = attribute.startsWith("node") ? "node.ge-selected" : "edge.ge-selected";
    assert.ok(order.indexOf(attribute) < order.indexOf(selected), `${attribute} comes after ${selected}`);
  }
  // Text on the light selection fill is ink, even if the vertex's own color asked for white.
  assert.equal(styleOf("node.ge-selected").color, colors.ink);
  assert.equal(styleOf("edge.ge-selected")["target-arrow-color"], colors.accent);
  // A wide edge doesn't get thinner when selected.
  assert.equal(styleOf("edge.ge-selected").width, undefined);
  assert.equal(styleOf("edge.ge-selected[^width]").width, 3);
});

test("text on a colored vertex is black or white, whichever reads better", () => {
  assert.equal(readableText("#000080"), "#ffffff"); // navy
  assert.equal(readableText("#d62728"), "#ffffff"); // matplotlib red
  assert.equal(readableText("#ffff00"), "#000000"); // yellow
  assert.equal(readableText("#ffffff"), "#000000");
  assert.equal(readableText("#1f77b4"), "#ffffff"); // matplotlib blue
  assert.equal(readableText("#2ca02c"), "#000000"); // matplotlib green: black reads better
});
