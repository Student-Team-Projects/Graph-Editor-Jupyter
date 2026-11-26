// The Cytoscape stylesheet. Kept free of DOM code so it can be tested in Node (style.test.ts);
// widget.ts reads the theme colours and passes them in.
import type { Css, StylesheetJson } from "cytoscape";

export interface Colors {
  ink: string;
  paper: string;
  accent: string;
  accentSoft: string;
}

// Black or white text, whichever reads better on a fill of `hex` (#rrggbb), by WCAG contrast.
export function readableText(hex: string): string {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  // Contrast with black is (L + 0.05) / 0.05, with white 1.05 / (L + 0.05); equal at L = 0.179.
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

// Rules with [data] selectors draw what the graph's attributes set (elements.ts); they come
// before the selection rules, so a selected vertex or edge still shows the accent.
export function graphStyle({ ink, paper, accent, accentSoft }: Colors): StylesheetJson {
  return [
    {
      // Cytoscape shades the canvas while it is pressed; our selection colours are the feedback.
      selector: "core",
      // The typings demand every core property, though Cytoscape accepts any subset.
      style: { "active-bg-opacity": 0 } as Css.Core,
    },
    {
      selector: "node",
      style: {
        width: "data(size)",
        height: "data(size)",
        "background-color": paper,
        "border-color": ink,
        "border-width": 2,
        label: "data(label)",
        color: ink,
        "font-family": "system-ui, sans-serif",
        "font-size": 13,
        "font-weight": 600,
        "text-valign": "center",
        "text-halign": "center",
        "overlay-opacity": 0, // no grey box over a pressed vertex
      },
    },
    { selector: "node[color]", style: { "background-color": "data(color)" } },
    { selector: "node[textColor]", style: { color: "data(textColor)" } },
    {
      selector: "edge",
      style: {
        width: 2,
        "line-color": ink,
        "curve-style": "bezier",
        "overlay-opacity": 0,
        "target-arrow-color": ink,
        "arrow-scale": 1.2,
      },
    },
    { selector: "edge[?arrow]", style: { "target-arrow-shape": "triangle" } },
    { selector: "edge[color]", style: { "line-color": "data(color)", "target-arrow-color": "data(color)" } },
    { selector: "edge[width]", style: { width: "data(width)" } },
    {
      // The weight sits on the middle of the edge, on a patch of paper so lines don't run through it.
      selector: "edge[label]",
      style: {
        label: "data(label)",
        color: ink,
        "font-family": "system-ui, sans-serif",
        "font-size": 12,
        "font-weight": 600,
        "text-background-color": paper,
        "text-background-opacity": 1,
        "text-background-padding": "2px",
        "text-background-shape": "roundrectangle",
      },
    },
    {
      selector: "edge:loop",
      style: { "loop-direction": "0deg", "loop-sweep": "45deg", "control-point-step-size": 40 },
    },
    {
      selector: "node.ge-selected",
      style: { "background-color": accentSoft, "border-color": accent, "border-width": 3, color: ink },
    },
    { selector: "edge.ge-selected", style: { "line-color": accent, "target-arrow-color": accent } },
    // Thicker when selected, unless the graph set the width: a wide edge must not get thinner.
    { selector: "edge.ge-selected[^width]", style: { width: 3 } },
  ];
}
