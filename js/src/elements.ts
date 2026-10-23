// Converts the synced model into Cytoscape element definitions. Kept free of DOM code so it
// can be tested in Node (elements.test.ts).
import type { ElementDefinition } from "cytoscape";

export interface ModelNode {
  id: number;
  label: string;
}

// Edges are undirected: (u, v) and (v, u) get the same id.
export function edgeId(u: number, v: number): string {
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
  edges: [number, number][],
  position: (id: number) => { x: number; y: number },
  radius: (label: string) => number,
): ElementDefinition[] {
  const known = new Set(nodes.map((n) => n.id));
  const elements: ElementDefinition[] = nodes.map(({ id, label }) => ({
    group: "nodes",
    data: { id: nodeId(id), label, size: 2 * radius(label) },
    position: { ...position(id) },
  }));
  const seen = new Set<string>();
  for (const [u, v] of edges) {
    const id = edgeId(u, v);
    if (!known.has(u) || !known.has(v) || seen.has(id)) continue;
    seen.add(id);
    elements.push({ group: "edges", data: { id, source: nodeId(u), target: nodeId(v) } });
  }
  return elements;
}
