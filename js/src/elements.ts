// Converts the synced model into Cytoscape element definitions. Kept free of DOM code so it
// can be tested in Node (elements.test.ts).
import type { ElementDefinition } from "cytoscape";

// Synced from widget.py (appearance.py decides what is set): the look comes from the graph's
// attributes, and anything not set keeps the default look.
export interface ModelNode {
  id: number;
  label: string;
  color?: string; // fill, a CSS color
  size?: number; // diameter in pixels; never smaller than the label needs
}

export interface ModelEdge {
  u: number; // from u to v if the graph is directed
  v: number;
  label?: string; // the weight, or the edge's label
  color?: string;
  width?: number; // in pixels
}

// A color to paint with, and a readable text color on it; null if it isn't a color.
export type Paint = (color: string) => { fill: string; text: string } | null;

// Undirected edges: (u, v) and (v, u) get the same id. Directed: u -> v and v -> u are two edges.
export function edgeId(u: number, v: number, directed = false): string {
  if (directed) return `e${u}>${v}`;
  return u <= v ? `e${u}-${v}` : `e${v}-${u}`;
}

export function nodeId(id: number): string {
  return `n${id}`;
}

export function idOfNode(cyId: string): number {
  return Number(cyId.slice(1));
}

export function toElements(
  nodes: ModelNode[],
  edges: ModelEdge[],
  directed: boolean,
  position: (id: number) => { x: number; y: number },
  radius: (node: ModelNode) => number,
  paint: Paint = (color) => ({ fill: color, text: "" }),
): ElementDefinition[] {
  const known = new Set(nodes.map((n) => n.id));
  const elements: ElementDefinition[] = nodes.map((node) => {
    const data: Record<string, unknown> = { id: nodeId(node.id), label: node.label, size: 2 * radius(node) };
    const painted = node.color ? paint(node.color) : null;
    if (painted) {
      data.color = painted.fill;
      if (painted.text) data.textColor = painted.text;
    }
    return { group: "nodes", data, position: { ...position(node.id) } };
  });
  const seen = new Set<string>();
  for (const { u, v, label, color, width } of edges) {
    const id = edgeId(u, v, directed);
    if (!known.has(u) || !known.has(v) || seen.has(id)) continue;
    seen.add(id);
    const data: Record<string, unknown> = { id, source: nodeId(u), target: nodeId(v) };
    if (directed) data.arrow = true;
    if (label !== undefined && label !== "") data.label = label;
    const painted = color ? paint(color) : null;
    if (painted) data.color = painted.fill;
    if (width !== undefined && width > 0) data.width = width;
    elements.push({ group: "edges", data });
  }
  return elements;
}
