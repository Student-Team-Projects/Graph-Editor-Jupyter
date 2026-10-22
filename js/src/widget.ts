import type { AnyModel, RenderProps } from "@anywidget/types";
import "./widget.css";

// Synced with GraphWidget traits in widget.py.
interface Model {
  nodes: string[];
  edges: [number, number][];
  positions: [number, number][];
  width: number;
  height: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_RADIUS = 16;
const PADDING = NODE_RADIUS + 4;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

// Positions arrive normalized to [0, 1]; map them into the drawing area.
function toScreen(model: AnyModel<Model>, [x, y]: [number, number]): [number, number] {
  const w = model.get("width");
  const h = model.get("height");
  return [PADDING + x * (w - 2 * PADDING), PADDING + y * (h - 2 * PADDING)];
}

function draw(model: AnyModel<Model>, root: SVGSVGElement): void {
  const nodes = model.get("nodes");
  const edges = model.get("edges");
  const points = model.get("positions").map((p) => toScreen(model, p));

  root.setAttribute("width", String(model.get("width")));
  root.setAttribute("height", String(model.get("height")));
  root.replaceChildren();

  const edgeLayer = svg("g", { class: "ge-edges" });
  for (const [u, v] of edges) {
    const [x1, y1] = points[u];
    const [x2, y2] = points[v];
    edgeLayer.append(svg("line", { x1, y1, x2, y2 }));
  }

  const nodeLayer = svg("g", { class: "ge-nodes" });
  nodes.forEach((label, i) => {
    const [cx, cy] = points[i];
    const group = svg("g", { class: "ge-node" });
    group.append(svg("circle", { cx, cy, r: NODE_RADIUS }));
    const text = svg("text", { x: cx, y: cy });
    text.textContent = label;
    group.append(text);
    nodeLayer.append(group);
  });

  root.append(edgeLayer, nodeLayer);
}

function render({ model, el, signal }: RenderProps<Model>): void {
  const root = svg("svg", { class: "ge-canvas" });
  el.classList.add("graph-editor");
  el.append(root);

  const redraw = () => draw(model, root);
  for (const trait of ["nodes", "edges", "positions", "width", "height"]) {
    model.on(`change:${trait}`, redraw);
    signal.addEventListener("abort", () => model.off(`change:${trait}`, redraw));
  }
  redraw();
}

export default { render };
