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
import {
  clickVertex,
  easeInOut,
  hint,
  isRepeatClick,
  keyAction,
  MOVE_MS,
  wheelZoomFactor,
  type Click,
  type Selection,
} from "./interaction";
import { forgetPageOffset } from "./pageOffset";
import { graphStyle, type Colors } from "./style";
import "./widget.css";

// Synced with GraphWidget traits in widget.py.
interface Model {
  nodes: ModelNode[];
  edges: [number, number][];
  positions: Record<string, [number, number]>;
  width: number;
  height: number;
  can_undo: boolean;
  can_redo: boolean;
}

const PADDING = 20; // must match PADDING in widget.py
const LABEL_FONT = "600 13px system-ui, sans-serif";
const ZOOM_STEP = 1.25;
const SVG_NS = "http://www.w3.org/2000/svg";

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

function themeColors(el: HTMLElement): Colors {
  return {
    ink: themeColor(el, "--jp-ui-font-color0", "#1a1a1a"),
    paper: themeColor(el, "--jp-layout-color0", "#ffffff"),
    accent: themeColor(el, "--jp-brand-color1", "#1976d2"),
    accentSoft: themeColor(el, "--jp-brand-color3", "#bbdefb"),
  };
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
  private readonly undoButton = button("Undo", "Undo (Ctrl+Z)");
  private readonly redoButton = button("Redo", "Redo (Ctrl+Y)");
  private readonly arrangeButton = button("Arrange", "Redraw the graph with as few edge crossings as possible");
  private animation = 0; // requestAnimationFrame id of the running glide
  private readonly help = document.createElement("span");
  // Dashed line from the selected vertex to the pointer: the edge the next click would add.
  private readonly preview = document.createElementNS(SVG_NS, "svg");
  private readonly previewLine = document.createElementNS(SVG_NS, "line");
  private pointer: { x: number; y: number } | null = null; // rendered coordinates
  private hovered: number | null = null; // vertex under the pointer
  private dragging = false;
  private moveRecorded = false;
  private lastAdd: Click | null = null; // the click that last added a vertex
  private structureKey = "";

  constructor(private readonly model: AnyModel<Model>, el: HTMLElement, signal: AbortSignal) {
    el.classList.add("graph-editor");

    const toolbar = document.createElement("div");
    toolbar.className = "ge-toolbar";
    const zoomOut = button("−", "Zoom out");
    const zoomIn = button("+", "Zoom in");
    const fit = button("Fit", "Show the whole graph");
    this.help.className = "ge-help";
    toolbar.append(this.forceButton, this.arrangeButton, this.undoButton, this.redoButton, zoomOut, zoomIn, fit, this.help);

    this.container.className = "ge-canvas";
    this.container.tabIndex = 0;
    el.append(toolbar, this.container);
    this.sizeContainer();

    this.cy = cytoscape({
      container: this.container,
      layout: { name: "preset" },
      autounselectify: true, // selection is ours, so clicks behave the same everywhere
      boxSelectionEnabled: false,
      userZoomingEnabled: false, // the plain wheel keeps scrolling the notebook; see onWheel
      minZoom: 0.2,
      maxZoom: 5,
      style: graphStyle(themeColors(el)),
    });
    // The widget is created before Jupyter attaches it to the page: until then the canvas has
    // no size and theme colours can't be read. Refresh both once it is visible.
    const observer = new ResizeObserver(() => {
      this.cy.resize();
      this.cy.style(graphStyle(themeColors(el)));
    });
    observer.observe(this.container);
    signal.addEventListener("abort", () => observer.disconnect());
    signal.addEventListener("abort", () => this.cy.destroy());
    this.preview.classList.add("ge-preview");
    this.preview.append(this.previewLine);
    this.container.append(this.preview);

    this.simulation = createSimulation()
      .on("tick", () => this.onTick())
      .on("end", () => this.sendPositions());
    signal.addEventListener("abort", () => this.simulation.stop());
    signal.addEventListener("abort", () => cancelAnimationFrame(this.animation));

    this.forceButton.addEventListener("click", () => this.setForce(!this.force), { signal });
    this.arrangeButton.addEventListener("click", () => this.arrange(), { signal });
    this.undoButton.addEventListener("click", () => this.edit({ type: "undo" }), { signal });
    this.redoButton.addEventListener("click", () => this.edit({ type: "redo" }), { signal });
    // After a toolbar click, keyboard shortcuts (Ctrl+Z, Delete) go to the graph again.
    toolbar.addEventListener("click", (e) => {
      if (e.target instanceof HTMLButtonElement) this.container.focus();
    }, { signal });
    zoomIn.addEventListener("click", () => this.zoomBy(ZOOM_STEP), { signal });
    zoomOut.addEventListener("click", () => this.zoomBy(1 / ZOOM_STEP), { signal });
    fit.addEventListener("click", () => this.cy.fit(undefined, PADDING), { signal });
    this.container.addEventListener("keydown", (e) => this.onKeyDown(e), { signal });
    // Not passive: Ctrl+wheel must not zoom the whole browser page.
    this.container.addEventListener("wheel", (e) => this.onWheel(e), { signal, passive: false });
    this.container.addEventListener("mouseleave", () => this.movePointer(null, null), { signal });
    // Keep Cytoscape's idea of where the canvas is on the page fresh (see pageOffset.ts).
    // Scroll events don't bubble, so listen in the capture phase to hear every scroller.
    const forget = () => forgetPageOffset(this.cy);
    document.addEventListener("scroll", forget, { signal, capture: true, passive: true });
    this.container.addEventListener("pointerenter", forget, { signal });
    this.container.addEventListener("pointerdown", forget, { signal, capture: true });
    this.bindGraphEvents();

    const onModelChange = () => this.loadFromModel();
    for (const trait of ["nodes", "edges", "positions", "width", "height"]) {
      model.on(`change:${trait}`, onModelChange);
      signal.addEventListener("abort", () => model.off(`change:${trait}`, onModelChange));
    }
    const onHistoryChange = () => this.updateHistoryButtons();
    for (const trait of ["can_undo", "can_redo"]) {
      model.on(`change:${trait}`, onHistoryChange);
      signal.addEventListener("abort", () => model.off(`change:${trait}`, onHistoryChange));
    }
    const onMessage = (msg: unknown) => this.onCustomMessage(msg);
    model.on("msg:custom", onMessage);
    signal.addEventListener("abort", () => model.off("msg:custom", onMessage));
    this.updateHistoryButtons();
    this.loadFromModel();
    // Force starts on (team decision 2026-10-23); it is gentle, so the first layout survives.
    this.setForce(true);
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

  // Zooms around a point in rendered coordinates, the canvas centre by default.
  private zoomBy(factor: number, at = { x: this.w / 2, y: this.h / 2 }): void {
    const level = Math.min(Math.max(this.cy.zoom() * factor, this.cy.minZoom()), this.cy.maxZoom());
    this.cy.zoom({ level, renderedPosition: at });
    this.updatePreview();
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

  private currentPositions(): Record<string, [number, number]> {
    const positions: Record<string, [number, number]> = {};
    for (const v of this.vertices.values()) positions[String(v.id)] = this.toModel(v.x ?? 0, v.y ?? 0);
    return positions;
  }

  private sendPositions(): void {
    this.model.set("positions", this.currentPositions());
    this.model.save_changes();
  }

  // Edits go to Python with the positions on screen, so undo restores exactly those.
  private edit(msg: Record<string, unknown>): void {
    this.model.send({ ...msg, positions: this.currentPositions() });
  }

  // Layout can take a few seconds for non-planar graphs; the reply is a set_positions message.
  private arrange(): void {
    this.arrangeButton.disabled = true;
    this.arrangeButton.textContent = "Arranging…";
    this.edit({ type: "arrange" });
  }

  // After Arrange, undo or redo, vertices glide to the spots Python sent, which become their
  // homes. After Arrange (`settle`), force mode then tidies up as when the editor opens.
  private onCustomMessage(msg: unknown): void {
    const m = msg as { type?: string; positions?: Record<string, [number, number]>; settle?: boolean };
    if (m.type !== "set_positions" || !m.positions) return;
    this.arrangeButton.disabled = false;
    this.arrangeButton.textContent = "Arrange";
    const moves: { v: Vertex; x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const v of this.vertices.values()) {
      const p = m.positions[String(v.id)];
      if (!p) continue;
      const [x1, y1] = this.toScreen(p);
      moves.push({ v, x0: v.x ?? 0, y0: v.y ?? 0, x1, y1 });
    }
    cancelAnimationFrame(this.animation);
    this.simulation.stop();
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const start = performance.now();
    const step = (now: number) => {
      const t = reduceMotion ? 1 : (now - start) / MOVE_MS;
      const k = easeInOut(t);
      for (const { v, x0, y0, x1, y1 } of moves) {
        if (this.cy.getElementById(nodeId(v.id)).grabbed()) continue;
        v.x = x0 + (x1 - x0) * k;
        v.y = y0 + (y1 - y0) * k;
      }
      this.updatePositions();
      if (t < 1) this.animation = requestAnimationFrame(step);
      else this.finishGlide(m.settle ?? false);
    };
    this.animation = requestAnimationFrame(step);
  }

  private finishGlide(settle: boolean): void {
    for (const v of this.vertices.values()) {
      v.vx = 0;
      v.vy = 0;
      this.clamp(v);
    }
    captureRestState(this.simulation, [...this.vertices.values()], this.links);
    this.updatePositions();
    if (this.force && settle) this.simulation.alpha(START_ALPHA).restart();
  }

  private updateHistoryButtons(): void {
    this.undoButton.disabled = !this.model.get("can_undo");
    this.redoButton.disabled = !this.model.get("can_redo");
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
    const text = hint(s);
    if (this.help.textContent !== text) this.help.textContent = text;
    this.updatePreview();
  }

  private updatePreview(): void {
    const selectedId = this.selection?.kind === "vertex" ? this.selection.id : null;
    const from = selectedId === null ? null : this.cy.getElementById(nodeId(selectedId));
    if (!from || from.empty() || !this.pointer || this.dragging) {
      this.preview.style.display = "none";
      return;
    }
    // Snaps to the vertex under the pointer, and runs border to border, not centre to centre.
    const to = this.hovered !== null && this.hovered !== selectedId ? this.cy.getElementById(nodeId(this.hovered)) : null;
    const a = from.renderedPosition();
    const b = to?.nonempty() ? to.renderedPosition() : this.pointer;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const startGap = from.renderedWidth() / 2;
    const endGap = to?.nonempty() ? to.renderedWidth() / 2 : 0;
    if (length <= startGap + endGap) {
      this.preview.style.display = "none";
      return;
    }
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    this.previewLine.setAttribute("x1", String(a.x + ux * startGap));
    this.previewLine.setAttribute("y1", String(a.y + uy * startGap));
    this.previewLine.setAttribute("x2", String(b.x - ux * endGap));
    this.previewLine.setAttribute("y2", String(b.y - uy * endGap));
    this.preview.style.display = "";
  }

  private movePointer(at: { x: number; y: number } | null, hovered: number | null): void {
    this.pointer = at;
    this.hovered = hovered;
    this.updatePreview();
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
      if (this.isRepeatOfAdd(e)) return;
      this.onClickVertex(idOfNode(e.target.id()));
    });
    cy.on("tap", "edge", (e) => {
      this.container.focus();
      const [u, v] = this.edgeEnds(e);
      const s = this.selection;
      const selected = s?.kind === "edge" && edgeId(s.u, s.v) === edgeId(u, v);
      this.select(selected ? null : { kind: "edge", u, v });
    });
    // Plain `tap`, not `onetap`: that one waits 250 ms to rule out a double click, which made
    // new vertices appear late. Double-click removes nothing (research/06).
    cy.on("tap", (e) => {
      if (e.target !== cy) return;
      this.container.focus();
      if (this.isRepeatOfAdd(e)) return;
      if (this.selection) {
        this.select(null);
      } else {
        const [x, y] = this.toModel(e.position.x, e.position.y);
        this.lastAdd = { ...e.renderedPosition, time: e.timeStamp };
        this.edit({ type: "add_node", x, y });
      }
    });
    cy.on("mousemove", (e) => {
      const target = e.target;
      const hovered = target !== cy && target.isNode() ? idOfNode(target.id()) : null;
      this.movePointer(e.renderedPosition, hovered);
    });
    cy.on("viewport", () => this.updatePreview());

    cy.on("grab", "node", () => {
      this.dragging = true;
      this.moveRecorded = false;
      this.updatePreview();
      if (this.force) this.simulation.alphaTarget(0.3).restart();
    });
    cy.on("drag", "node", (e) => {
      const node: NodeSingular = e.target;
      const vertex = this.vertices.get(idOfNode(node.id()));
      if (!vertex) return;
      if (!this.moveRecorded) {
        // A grab without movement is a click; only a real drag becomes an undo step.
        this.moveRecorded = true;
        this.edit({ type: "move" });
      }
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
      this.dragging = false;
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

  private isRepeatOfAdd(e: EventObject): boolean {
    const repeat = isRepeatClick(this.lastAdd, { ...e.renderedPosition, time: e.timeStamp });
    if (repeat) this.lastAdd = null;
    return repeat;
  }

  private onClickVertex(id: number): void {
    const result = clickVertex(this.selection, id, (u, v) => this.hasEdge(u, v));
    if (result.addEdge) this.edit({ type: "add_edge", u: result.addEdge[0], v: result.addEdge[1] });
    this.select(result.selection);
  }

  private onKeyDown(e: KeyboardEvent): void {
    const s = this.selection;
    const action = keyAction(e, s);
    if (action === null) return;
    if (action === "undo" || action === "redo") {
      this.edit({ type: action });
    } else if (action === "remove" && s) {
      if (s.kind === "vertex") this.edit({ type: "remove_node", id: s.id });
      else this.edit({ type: "remove_edge", u: s.u, v: s.v });
      this.select(null);
    } else {
      this.select(null);
    }
    // Handled here: keep the key away from JupyterLab's own shortcuts (its own undo too).
    e.preventDefault();
    e.stopPropagation();
  }

  // A plain wheel scrolls the notebook; Ctrl+wheel (or a touchpad pinch) zooms at the pointer.
  private onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const rect = this.container.getBoundingClientRect();
    const at = { x: e.clientX - rect.left - this.container.clientLeft, y: e.clientY - rect.top - this.container.clientTop };
    this.zoomBy(wheelZoomFactor(e.deltaY, e.deltaMode), at);
  }
}

function render({ model, el, signal }: RenderProps<Model>): void {
  new GraphEditor(model, el, signal);
}

export default { render };
