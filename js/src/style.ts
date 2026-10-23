// The Cytoscape stylesheet. Kept free of DOM code so it can be tested in Node (style.test.ts);
// widget.ts reads the theme colours and passes them in.
import type { Css, StylesheetJson } from "cytoscape";

export interface Colors {
  ink: string;
  paper: string;
  accent: string;
  accentSoft: string;
}

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
    {
      selector: "edge",
      style: { width: 2, "line-color": ink, "curve-style": "bezier", "overlay-opacity": 0 },
    },
    {
      selector: "edge:loop",
      style: { "loop-direction": "0deg", "loop-sweep": "45deg", "control-point-step-size": 40 },
    },
    { selector: "node.ge-selected", style: { "background-color": accentSoft, "border-color": accent, "border-width": 3 } },
    { selector: "edge.ge-selected", style: { "line-color": accent, width: 3 } },
  ];
}
