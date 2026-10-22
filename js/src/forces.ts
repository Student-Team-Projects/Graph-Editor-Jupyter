// Force mode physics. Kept free of DOM code so it can be tested in Node (forces.test.ts).
//
// Force mode is gentle (docs/research/03-existing-editors.md): edges keep their length,
// vertices only push each other when close, and a weak pull returns everything home.
// A full force re-layout would scramble the crossing-free first layout.
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

export const NODE_RADIUS = 16;
export const START_ALPHA = 0.3;
const PERSONAL_SPACE = NODE_RADIUS * 5; // repulsion reaches only this far
const HOME_PULL = 0.08;
const LINK_STRENGTH = 0.3;

export interface Vertex extends SimulationNodeDatum {
  id: number;
  label: string;
  r: number; // drawn radius; grows for long labels
  // Where the vertex springs back to in force mode.
  homeX: number;
  homeY: number;
}

// `rest` is the edge's natural length in force mode. Self-loops are not links.
export type Link = SimulationLinkDatum<Vertex> & { source: Vertex; target: Vertex; rest: number };

export type GraphSimulation = Simulation<Vertex, Link>;

export function createSimulation(): GraphSimulation {
  return forceSimulation<Vertex, Link>()
    .velocityDecay(0.5)
    .force("charge", forceManyBody<Vertex>().strength(-150).distanceMax(PERSONAL_SPACE))
    .force("link", forceLink<Vertex, Link>().distance((l) => l.rest).strength(LINK_STRENGTH))
    .force("collide", forceCollide<Vertex>((v) => v.r + NODE_RADIUS * 0.8))
    .force("homeX", forceX<Vertex>((v) => v.homeX).strength(HOME_PULL))
    .force("homeY", forceY<Vertex>((v) => v.homeY).strength(HOME_PULL))
    .stop();
}

const LABEL_MARGIN = 6; // space between a label and its circle

// Radius of a vertex whose label is `textWidth` pixels wide: long labels such as "(0, 1)"
// would not fit in the default circle.
export function radiusForLabel(textWidth: number): number {
  return Math.max(NODE_RADIUS, textWidth / 2 + LABEL_MARGIN);
}

export function homeDistance(a: Vertex, b: Vertex): number {
  return Math.max(Math.hypot(a.homeX - b.homeX, a.homeY - b.homeY), a.r + b.r + NODE_RADIUS);
}

// d3 caches accessor results; re-run them after vertices, homes, radii or rest lengths change.
export function refreshForces(sim: GraphSimulation, vertices: Vertex[], links: Link[]): void {
  sim.nodes(vertices);
  sim.force<ReturnType<typeof forceLink<Vertex, Link>>>("link")!.links(links);
  sim.force<ReturnType<typeof forceCollide<Vertex>>>("collide")!.radius((v) => v.r + NODE_RADIUS * 0.8);
  sim.force<ReturnType<typeof forceX<Vertex>>>("homeX")!.x((v) => v.homeX);
  sim.force<ReturnType<typeof forceY<Vertex>>>("homeY")!.y((v) => v.homeY);
}

// Current positions become home, and current edge lengths become natural lengths.
export function captureRestState(sim: GraphSimulation, vertices: Vertex[], links: Link[]): void {
  for (const v of vertices) {
    v.homeX = v.x ?? 0;
    v.homeY = v.y ?? 0;
  }
  for (const l of links) l.rest = homeDistance(l.source, l.target);
  refreshForces(sim, vertices, links);
}

// After a drag in force mode: the dropped vertex gets its new spot as home, and its edges
// take their new lengths. The vertices it pushed aside spring back to their own homes.
export function rehome(sim: GraphSimulation, vertex: Vertex, vertices: Vertex[], links: Link[]): void {
  vertex.homeX = vertex.x ?? 0;
  vertex.homeY = vertex.y ?? 0;
  for (const l of links) {
    if (l.source === vertex || l.target === vertex) l.rest = homeDistance(l.source, l.target);
  }
  refreshForces(sim, vertices, links);
}
