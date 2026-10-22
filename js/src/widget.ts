import type { AnyModel, RenderProps } from "@anywidget/types";
import cytoscape, { type Core, type EventObject, type NodeSingular } from "cytoscape";
import { edgeId, idOfNode, nodeId, toElements, type ModelNode } from "./elements";
import {
  captureRestState,
  createSimulation,
  homeDistance,
  NODE_RADIUS,
  radiusForLabel,
  refreshForces,
  rehome,
  START_ALPHA,
  type GraphSimulation,
  type Link,
  type Vertex,
} from "./forces";
import "./widget.css";

// Synced with GraphWidget traits in widget.py.
interface Model {
  nodes: ModelNode[];
  edges: [number, number][];
  positions: Record<string, [number, number]>;
  width: number;
  height: number;
}

type Selection = { kind: "vertex"; id: number } | { kind: "edge"; u: number; v: number } | null;

const PADDING = 20; // must match PADDING in widget.py
const LABEL_FONT = "600 13px system-ui, sans-serif";
const ZOOM_STEP = 1.25;

const HELP =
  "Click empty space: add vertex · Click two vertices: add edge · Drag: move · Double-click or Delete: remove";

// Colors come from JupyterLab's theme variables, with plain fallbacks for other hosts.
function themeColor(el: HTMLElement, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

let measureContext: CanvasRenderingContext2D | null = null;
function labelWidth(label: string): number {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return label.length * 8;
  measureContext.font = LABEL_FONT;
  return measureContext.measureText(label).width;
}

function button(text: string, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "ge-button";
  b.textContent = text;
  b.title = title;
  return b;
}

// Colours come from JupyterLab's theme, read when called.
function graphStyle(el: HTMLElement): cytoscape.StylesheetJson {
  const ink = themeColor(el, "--jp-ui-font-color0", "#1a1a1a");
  const paper = themeColor(el, "--jp-layout-color0", "#ffffff");
  const accent = themeColor(el, "--jp-brand-color1", "#1976d2");
  const accentSoft = themeColor(el, "--jp-brand-color3", "#bbdefb");
  return [
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
      },
    },
    {
      selector: "edge",
      style: { width: 2, "line-color": ink, "curve-style": "bezier" },
    },
    {
      selector: "edge:loop",
      style: { "loop-direction": "0deg", "loop-sweep": "45deg", "control-point-step-size": 40 },
    },
    { selector: "node.ge-selected", style: { "background-color": accentSoft, "border-color": accent, "border-width": 3 } },
    { selector: "edge.ge-selected", style: { "line-color": accent, width: 3 } },
  ];
}

class GraphEditor {
  private vertices = new Map<number, Vertex>();
  private links: Link[] = []; // edges between two different vertices
  private selection: Selection = null;
  private force = false;
  private readonly simulation: GraphSimulation;
  private readonly cy: Core;
  private readonly container = document.createElement("div");
  private readonly forceButton = button("Force: off", "Turn physics on or off");
  private structureKey = "";

  constructor(private readonly model: AnyModel<Model>, el: HTMLElement, signal: AbortSignal) {
    el.classList.add("graph-editor");

    const toolbar = document.createElement("div");
    toolbar.className = "ge-toolbar";
    const zoomOut = button("−", "Zoom out");
    const zoomIn = button("+", "Zoom in");
    const fit = button("Fit", "Show the whole graph");
    const help = document.createElement("span");
    help.className = "ge-help";
    help.textContent = HELP;
    toolbar.append(this.forceButton, zoomOut, zoomIn, fit, help);

    this.container.className = "ge-canvas";
    this.container.tabIndex = 0;
    el.append(toolbar, this.container);
    this.sizeContainer();

    this.cy = cytoscape({
      container: this.container,
      layout: { name: "preset" },
      autounselectify: true, // selection is ours, so clicks behave the same everywhere
      boxSelectionEnabled: false,
      userZoomingEnabled: false, // the mouse wheel keeps scrolling the notebook; use the buttons
      minZoom: 0.2,
      maxZoom: 5,
      style: graphStyle(el),
    });
    // The widget is created before Jupyter attaches it to the page: until then the canvas has
    // no size and theme colours can't be read. Refresh both once it is visible.
    const observer = new ResizeObserver(() => {
      this.cy.resize();
      this.cy.style(graphStyle(el));
    });
    observer.observe(this.container);
    signal.addEventListener("abort", () => observer.disconnect());
    signal.addEventListener("abort", () => this.cy.destroy());

    this.simulation = createSimulation()
      .on("tick", () => this.onTick())
      .on("end", () => this.sendPositions());
    signal.addEventListener("abort", () => this.simulation.stop());

    this.forceButton.addEventListener("click", () => this.setForce(!this.force), { signal });
    zoomIn.addEventListener("click", () => this.zoomBy(ZOOM_STEP), { signal });
    zoomOut.addEventListener("click", () => this.zoomBy(1 / ZOOM_STEP), { signal });
    fit.addEventListener("click", () => this.cy.fit(undefined, PADDING), { signal });
    this.container.addEventListener("keydown", (e) => this.onKeyDown(e), { signal });
    this.bindGraphEvents();

    const onModelChange = () => this.loadFromModel();
    for (const trait of ["nodes", "edges", "positions", "width", "height"]) {
      model.on(`change:${trait}`, onModelChange);
      signal.addEventListener("abort", () => model.off(`change:${trait}`, onModelChange));
    }
    this.loadFromModel();
    this.setForce(false);
  }

  // ---- coordinates ----

  private get w(): number {
    return this.model.get("width");
  }

  private get h(): number {
    return this.model.get("height");
  }

  private sizeContainer(): void {
    this.container.style.width = `${this.w}px`;
    this.container.style.height = `${this.h}px`;
  }

  private toScreen([x, y]: [number, number]): [number, number] {
    return [PADDING + x * (this.w - 2 * PADDING), PADDING + y * (this.h - 2 * PADDING)];
  }

  private toModel(x: number, y: number): [number, number] {
    return [(x - PADDING) / (this.w - 2 * PADDING), (y - PADDING) / (this.h - 2 * PADDING)];
  }

  private clamp(v: Vertex): void {
    v.x = Math.min(Math.max(v.x ?? 0, v.r), this.w - v.r);
    v.y = Math.min(Math.max(v.y ?? 0, v.r), this.h - v.r);
  }

  private zoomBy(factor: number): void {
    this.cy.zoom({ level: this.cy.zoom() * factor, renderedPosition: { x: this.w / 2, y: this.h / 2 } });
  }

  // ---- state from Python ----

  // Rebuilds vertices and edges from the model. Vertices already shown keep their
  // current position; Python's positions are used only for new ones.
  private loadFromModel(): void {
    const positions = this.model.get("positions");
    const oldRest = new Map(this.links.map((l) => [edgeId(l.source.id, l.target.id), l.rest]));
    const next = new Map<number, Vertex>();
    for (const { id, label } of this.model.get("nodes")) {
      const old = this.vertices.get(id);
      const r = radiusForLabel(labelWidth(label));
      if (old) {
        old.label = label;
        old.r = r;
        next.set(id, old);
      } else {
        const [x, y] = this.toScreen(positions[String(id)] ?? [0.5, 0.5]);
        next.set(id, { id, label, r, x, y, homeX: x, homeY: y });
      }
    }
    this.vertices = next;
    for (const v of next.values()) this.clamp(v);

    const edges = this.model.get("edges").filter(([u, v]) => next.has(u) && next.has(v));
    this.links = edges
      .filter(([u, v]) => u !== v)
      .map(([u, v]) => {
        const source = next.get(u)!;
        const target = next.get(v)!;
        return { source, target, rest: oldRest.get(edgeId(u, v)) ?? homeDistance(source, target) };
      });

    if (this.selection?.kind === "vertex" && !next.has(this.selection.id)) this.selection = null;
    const s = this.selection;
    if (s?.kind === "edge" && !edges.some(([u, v]) => edgeId(u, v) === edgeId(s.u, s.v))) this.selection = null;

    this.syncElements(edges);
    refreshForces(this.simulation, [...this.vertices.values()], this.links);
    // Only real structure changes restart physics; position updates we sent ourselves must not.
    const key = JSON.stringify([this.model.get("nodes"), this.model.get("edges")]);
    if (this.force && key !== this.structureKey) this.simulation.alpha(START_ALPHA).restart();
    this.structureKey = key;
  }

  // Adds, updates and removes Cytoscape elements so they match the model, without
  // recreating elements that still exist (a vertex being dragged must survive).
  private syncElements(edges: [number, number][]): void {
    const wanted = toElements(
      [...this.vertices.values()].map(({ id, label }) => ({ id, label })),
      edges,
      (id) => ({ x: this.vertices.get(id)!.x ?? 0, y: this.vertices.get(id)!.y ?? 0 }),
      (label) => radiusForLabel(labelWidth(label)),
    );
    const wantedIds = new Set(wanted.map((e) => e.data.id));
    this.sizeContainer();
    this.cy.batch(() => {
      this.cy.elements().filter((e) => !wantedIds.has(e.id())).remove();
      for (const def of wanted) {
        const existing = this.cy.getElementById(def.data.id!);
        if (existing.nonempty()) existing.data(def.data);
        else this.cy.add(def);
      }
    });
    this.cy.resize();
    this.updatePositions();
  }

  private sendPositions(): void {
    const positions: Record<string, [number, number]> = {};
    for (const v of this.vertices.values()) positions[String(v.id)] = this.toModel(v.x ?? 0, v.y ?? 0);
    this.model.set("positions", positions);
    this.model.save_changes();
  }

  // ---- drawing ----

  private updatePositions(): void {
    const s = this.selection;
    this.cy.batch(() => {
      for (const v of this.vertices.values()) {
        const node = this.cy.getElementById(nodeId(v.id));
        if (!node.grabbed()) node.position({ x: v.x ?? 0, y: v.y ?? 0 });
        node.toggleClass("ge-selected", s?.kind === "vertex" && s.id === v.id);
      }
      this.cy.edges().forEach((edge) => {
        const selected = s?.kind === "edge" && edge.id() === edgeId(s.u, s.v);
        edge.toggleClass("ge-selected", selected);
      });
    });
  }

  private onTick(): void {
    for (const v of this.vertices.values()) this.clamp(v);
    this.updatePositions();
  }

  // ---- modes ----

  private setForce(on: boolean): void {
    this.force = on;
    this.forceButton.textContent = on ? "Force: on" : "Force: off";
    this.forceButton.setAttribute("aria-pressed", String(on));
    if (on) {
      captureRestState(this.simulation, [...this.vertices.values()], this.links);
      this.simulation.alpha(START_ALPHA).restart();
    } else {
      // Freezing keeps every vertex exactly where it is now.
      this.simulation.stop();
      for (const v of this.vertices.values()) {
        v.vx = 0;
        v.vy = 0;
      }
      this.sendPositions();
    }
  }

  // ---- selection ----

  private select(selection: Selection): void {
    this.selection = selection;
    this.updatePositions();
  }

  private edgeEnds(e: EventObject): [number, number] {
    const edge = e.target;
    return [idOfNode(edge.source().id()), idOfNode(edge.target().id())];
  }

  private hasEdge(u: number, v: number): boolean {
    return this.cy.getElementById(edgeId(u, v)).nonempty();
  }

  // ---- input ----

  private bindGraphEvents(): void {
    const cy = this.cy;
    cy.on("tap", "node", (e) => {
      this.container.focus();
      this.clickVertex(idOfNode(e.target.id()));
    });
    cy.on("tap", "edge", (e) => {
      this.container.focus();
      const [u, v] = this.edgeEnds(e);
      const s = this.selection;
      const selected = s?.kind === "edge" && edgeId(s.u, s.v) === edgeId(u, v);
      this.select(selected ? null : { kind: "edge", u, v });
    });
    // `onetap` fires only when the tap is not part of a double tap, so double-clicking
    // empty space doesn't add a vertex.
    cy.on("onetap", (e) => {
      if (e.target !== cy) return;
      this.container.focus();
      if (this.selection) {
        this.select(null);
      } else {
        const [x, y] = this.toModel(e.position.x, e.position.y);
        this.model.send({ type: "add_node", x, y });
      }
    });
    cy.on("dbltap", "node", (e) => {
      this.model.send({ type: "remove_node", id: idOfNode(e.target.id()) });
      this.select(null);
    });
    cy.on("dbltap", "edge", (e) => {
      const [u, v] = this.edgeEnds(e);
      this.model.send({ type: "remove_edge", u, v });
      this.select(null);
    });

    cy.on("grab", "node", () => {
      if (this.force) this.simulation.alphaTarget(0.3).restart();
    });
    cy.on("drag", "node", (e) => {
      const node: NodeSingular = e.target;
      const vertex = this.vertices.get(idOfNode(node.id()));
      if (!vertex) return;
      const p = node.position();
      vertex.x = p.x;
      vertex.y = p.y;
      this.clamp(vertex);
      if (vertex.x !== p.x || vertex.y !== p.y) node.position({ x: vertex.x!, y: vertex.y! });
      if (this.force) {
        // Pinned under the pointer; neighbours react through the simulation.
        vertex.fx = vertex.x;
        vertex.fy = vertex.y;
      }
    });
    cy.on("free", "node", (e) => {
      const vertex = this.vertices.get(idOfNode(e.target.id()));
      if (!vertex) return;
      if (this.force) {
        // Released vertices rejoin the simulation with the drop spot as their new home;
        // the vertices pushed aside spring back to theirs.
        vertex.fx = null;
        vertex.fy = null;
        rehome(this.simulation, vertex, [...this.vertices.values()], this.links);
        this.simulation.alphaTarget(0);
      } else {
        this.sendPositions();
      }
    });
  }

  private clickVertex(id: number): void {
    const s = this.selection;
    if (s?.kind === "vertex" && s.id === id) {
      this.select(null);
    } else if (s?.kind === "vertex") {
      if (!this.hasEdge(s.id, id)) this.model.send({ type: "add_edge", u: s.id, v: id });
      // Selection moves on, so clicking vertices one after another draws a path.
      this.select({ kind: "vertex", id });
    } else {
      this.select({ kind: "vertex", id });
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    const s = this.selection;
    if (e.key === "Escape") {
      this.select(null);
    } else if ((e.key === "Delete" || e.key === "Backspace") && s) {
      if (s.kind === "vertex") this.model.send({ type: "remove_node", id: s.id });
      else this.model.send({ type: "remove_edge", u: s.u, v: s.v });
      this.select(null);
    } else {
      return;
    }
    // Handled here: keep the key away from JupyterLab's own shortcuts.
    e.preventDefault();
    e.stopPropagation();
  }
}

function render({ model, el, signal }: RenderProps<Model>): void {
  new GraphEditor(model, el, signal);
}

export default { render };
