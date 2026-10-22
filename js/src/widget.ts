import type { AnyModel, RenderProps } from "@anywidget/types";
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
  nodes: { id: number; label: string }[];
  edges: [number, number][];
  positions: Record<string, [number, number]>;
  width: number;
  height: number;
}

type Selection = { kind: "vertex"; id: number } | { kind: "edge"; u: number; v: number } | null;

const SVG_NS = "http://www.w3.org/2000/svg";
const PADDING = 20; // must match PADDING in widget.py
const DRAG_THRESHOLD = 4; // pixels before a press counts as a drag
const DOUBLE_CLICK_MS = 250; // empty-space clicks wait this long so a double click doesn't add a vertex

const HELP =
  "Click empty space: add vertex · Click two vertices: add edge · Drag: move · Double-click or Delete: remove";

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

class GraphEditor {
  private vertices = new Map<number, Vertex>();
  private links: Link[] = []; // edges between two different vertices
  private loops: Vertex[] = []; // vertices with a self-loop
  private selection: Selection = null;
  private force = false;
  private readonly simulation: GraphSimulation;
  private readonly root: SVGSVGElement;
  private readonly edgeLayer = svg("g", { class: "ge-edges" });
  private readonly nodeLayer = svg("g", { class: "ge-nodes" });
  private readonly forceButton = document.createElement("button");
  private pendingAdd: number | undefined;
  private structureKey = "";

  constructor(private readonly model: AnyModel<Model>, el: HTMLElement, signal: AbortSignal) {
    el.classList.add("graph-editor");

    const toolbar = document.createElement("div");
    toolbar.className = "ge-toolbar";
    this.forceButton.className = "ge-button";
    this.forceButton.addEventListener("click", () => this.setForce(!this.force), { signal });
    const help = document.createElement("span");
    help.className = "ge-help";
    help.textContent = HELP;
    toolbar.append(this.forceButton, help);

    this.root = svg("svg", { class: "ge-canvas", tabindex: 0 });
    this.root.append(this.edgeLayer, this.nodeLayer);
    el.append(toolbar, this.root);

    this.simulation = createSimulation()
      .on("tick", () => this.onTick())
      .on("end", () => this.sendPositions());
    signal.addEventListener("abort", () => this.simulation.stop());

    this.root.addEventListener("pointerdown", (e) => this.onPointerDown(e), { signal });
    this.root.addEventListener("dblclick", (e) => this.onDoubleClick(e), { signal });
    this.root.addEventListener("keydown", (e) => this.onKeyDown(e), { signal });

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

  private toScreen([x, y]: [number, number]): [number, number] {
    return [PADDING + x * (this.w - 2 * PADDING), PADDING + y * (this.h - 2 * PADDING)];
  }

  private toModel(x: number, y: number): [number, number] {
    return [(x - PADDING) / (this.w - 2 * PADDING), (y - PADDING) / (this.h - 2 * PADDING)];
  }

  private pointer(e: MouseEvent): [number, number] {
    const matrix = this.root.getScreenCTM();
    if (!matrix) return [e.offsetX, e.offsetY];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return [p.x, p.y];
  }

  private clamp(v: Vertex): void {
    v.x = Math.min(Math.max(v.x ?? 0, v.r), this.w - v.r);
    v.y = Math.min(Math.max(v.y ?? 0, v.r), this.h - v.r);
  }

  // ---- state from Python ----

  // Rebuilds vertices and edges from the model. Vertices already shown keep their
  // current position; Python's positions are used only for new ones.
  private loadFromModel(): void {
    const positions = this.model.get("positions");
    const oldRest = new Map(this.links.map((l) => [this.linkKey(l.source.id, l.target.id), l.rest]));
    const next = new Map<number, Vertex>();
    for (const { id, label } of this.model.get("nodes")) {
      const old = this.vertices.get(id);
      if (old) {
        old.label = label;
        next.set(id, old);
      } else {
        const [x, y] = this.toScreen(positions[String(id)] ?? [0.5, 0.5]);
        next.set(id, { id, label, r: NODE_RADIUS, x, y, homeX: x, homeY: y });
      }
    }
    this.vertices = next;

    const edges = this.model.get("edges").filter(([u, v]) => next.has(u) && next.has(v));
    this.loops = edges.filter(([u, v]) => u === v).map(([u]) => next.get(u)!);
    this.links = edges
      .filter(([u, v]) => u !== v)
      .map(([u, v]) => {
        const source = next.get(u)!;
        const target = next.get(v)!;
        return { source, target, rest: oldRest.get(this.linkKey(u, v)) ?? homeDistance(source, target) };
      });

    if (this.selection?.kind === "vertex" && !next.has(this.selection.id)) this.selection = null;
    if (this.selection?.kind === "edge" && !this.hasEdge(this.selection.u, this.selection.v)) this.selection = null;

    this.rebuild();
    refreshForces(this.simulation, [...this.vertices.values()], this.links);
    // Only real structure changes restart physics; position updates we sent ourselves must not.
    const key = JSON.stringify([this.model.get("nodes"), this.model.get("edges")]);
    if (this.force && key !== this.structureKey) this.simulation.alpha(START_ALPHA).restart();
    this.structureKey = key;
  }

  private linkKey(u: number, v: number): string {
    return u < v ? `${u}-${v}` : `${v}-${u}`;
  }

  private sendPositions(): void {
    const positions: Record<string, [number, number]> = {};
    for (const v of this.vertices.values()) positions[String(v.id)] = this.toModel(v.x ?? 0, v.y ?? 0);
    this.model.set("positions", positions);
    this.model.save_changes();
  }

  // ---- drawing ----

  private rebuild(): void {
    this.root.setAttribute("viewBox", `0 0 ${this.w} ${this.h}`);
    this.root.setAttribute("width", String(this.w));
    this.root.setAttribute("height", String(this.h));
    this.edgeLayer.replaceChildren();
    this.nodeLayer.replaceChildren();

    const addEdge = (u: number, v: number, ...shapes: SVGElement[]) => {
      const group = svg("g", { class: "ge-edge" });
      group.dataset.u = String(u);
      group.dataset.v = String(v);
      group.append(...shapes);
      this.edgeLayer.append(group);
    };
    for (const link of this.links) {
      addEdge(link.source.id, link.target.id, svg("line", { class: "ge-edge-hit" }), svg("line", { class: "ge-edge-line" }));
    }
    for (const v of this.loops) {
      addEdge(v.id, v.id, svg("circle", { class: "ge-edge-hit" }), svg("circle", { class: "ge-edge-line" }));
    }

    for (const v of this.vertices.values()) {
      const group = svg("g", { class: "ge-node" });
      group.dataset.id = String(v.id);
      const circle = svg("circle");
      const text = svg("text");
      text.textContent = v.label;
      group.append(circle, text);
      this.nodeLayer.append(group);
      // Grow the circle to fit long labels such as "(0, 1)". Measuring needs the text in the
      // document; if it isn't rendered yet, estimate from the number of characters.
      const width = text.getComputedTextLength() || v.label.length * 8;
      v.r = radiusForLabel(width);
      circle.setAttribute("r", String(v.r));
    }
    this.updatePositions();
  }

  private updatePositions(): void {
    const groups = this.edgeLayer.children;
    this.links.forEach((link, i) => {
      groups[i].classList.toggle("ge-selected", this.isSelectedEdge(link.source.id, link.target.id));
      for (const line of groups[i].children) {
        line.setAttribute("x1", String(link.source.x));
        line.setAttribute("y1", String(link.source.y));
        line.setAttribute("x2", String(link.target.x));
        line.setAttribute("y2", String(link.target.y));
      }
    });
    this.loops.forEach((v, i) => {
      const group = groups[this.links.length + i];
      group.classList.toggle("ge-selected", this.isSelectedEdge(v.id, v.id));
      for (const circle of group.children) {
        // A small circle sitting on top of the vertex.
        circle.setAttribute("cx", String(v.x));
        circle.setAttribute("cy", String((v.y ?? 0) - v.r));
        circle.setAttribute("r", String(v.r * 0.75));
      }
    });
    let i = 0;
    for (const v of this.vertices.values()) {
      const group = this.nodeLayer.children[i++];
      group.setAttribute("transform", `translate(${v.x},${v.y})`);
      group.classList.toggle("ge-selected", this.selection?.kind === "vertex" && this.selection.id === v.id);
    }
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

  // ---- hit testing and selection ----

  private vertexAt(target: EventTarget | null): Vertex | undefined {
    const group = (target as Element | null)?.closest?.(".ge-node") as SVGGElement | null;
    return group ? this.vertices.get(Number(group.dataset.id)) : undefined;
  }

  private edgeAt(target: EventTarget | null): [number, number] | undefined {
    const group = (target as Element | null)?.closest?.(".ge-edge") as SVGGElement | null;
    return group ? [Number(group.dataset.u), Number(group.dataset.v)] : undefined;
  }

  private hasEdge(u: number, v: number): boolean {
    if (u === v) return this.loops.some((l) => l.id === u);
    return this.links.some(
      (l) => (l.source.id === u && l.target.id === v) || (l.source.id === v && l.target.id === u),
    );
  }

  private isSelectedEdge(u: number, v: number): boolean {
    const s = this.selection;
    return s?.kind === "edge" && ((s.u === u && s.v === v) || (s.u === v && s.v === u));
  }

  private select(selection: Selection): void {
    this.selection = selection;
    this.updatePositions();
  }

  // ---- input ----

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.root.focus();
    const vertex = this.vertexAt(e.target);
    const edge = vertex ? undefined : this.edgeAt(e.target);
    const [startX, startY] = this.pointer(e);
    let dragging = false;

    const move = (ev: PointerEvent) => {
      if (!vertex) return;
      const [x, y] = this.pointer(ev);
      if (!dragging && Math.hypot(x - startX, y - startY) < DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        if (this.force) this.simulation.alphaTarget(0.3).restart();
      }
      if (this.force) {
        vertex.fx = x;
        vertex.fy = y;
      } else {
        vertex.x = x;
        vertex.y = y;
        this.clamp(vertex);
        this.updatePositions();
      }
    };

    const up = () => {
      this.root.removeEventListener("pointermove", move);
      this.root.removeEventListener("pointerup", up);
      this.root.removeEventListener("pointercancel", up);
      if (dragging && vertex) {
        if (this.force) {
          vertex.x = vertex.fx ?? vertex.x;
          vertex.y = vertex.fy ?? vertex.y;
          vertex.fx = null;
          vertex.fy = null;
          rehome(this.simulation, vertex, [...this.vertices.values()], this.links);
          this.simulation.alphaTarget(0);
        } else {
          this.sendPositions();
        }
      } else if (vertex) {
        this.clickVertex(vertex.id);
      } else if (edge) {
        this.select(this.isSelectedEdge(...edge) ? null : { kind: "edge", u: edge[0], v: edge[1] });
      } else {
        this.clickEmpty(startX, startY);
      }
    };

    this.root.setPointerCapture(e.pointerId);
    this.root.addEventListener("pointermove", move);
    this.root.addEventListener("pointerup", up);
    this.root.addEventListener("pointercancel", up);
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

  private clickEmpty(x: number, y: number): void {
    if (this.selection) {
      this.select(null);
      return;
    }
    window.clearTimeout(this.pendingAdd);
    this.pendingAdd = window.setTimeout(() => {
      const [mx, my] = this.toModel(x, y);
      this.model.send({ type: "add_node", x: mx, y: my });
    }, DOUBLE_CLICK_MS);
  }

  private onDoubleClick(e: MouseEvent): void {
    // With pointer capture, the event target can be the whole canvas, so look up what is under the cursor.
    const root = this.root.getRootNode() as Document | ShadowRoot;
    const target = root.elementFromPoint(e.clientX, e.clientY);
    const vertex = this.vertexAt(target);
    const edge = vertex ? undefined : this.edgeAt(target);
    if (vertex) {
      this.model.send({ type: "remove_node", id: vertex.id });
    } else if (edge) {
      this.model.send({ type: "remove_edge", u: edge[0], v: edge[1] });
    } else {
      window.clearTimeout(this.pendingAdd);
    }
    this.select(null);
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
