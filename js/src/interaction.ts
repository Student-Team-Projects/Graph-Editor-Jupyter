// What clicks, keys and the wheel do, decided without the DOM so it can be tested in Node
// (interaction.test.ts). The reasons are in docs/research/06-interaction-review.md.

export type Selection = { kind: "vertex"; id: number } | { kind: "edge"; u: number; v: number } | null;

export const HELP =
  "Click empty space: add vertex · Click two vertices: add edge · Drag: move · Delete: remove · Ctrl+Z: undo · Ctrl+wheel: zoom";

// The help line, telling the user what the next click does.
export function hint(selection: Selection): string {
  if (selection?.kind === "vertex") return "Click another vertex to connect · Delete: remove vertex · Esc: cancel";
  if (selection?.kind === "edge") return "Delete: remove edge · Esc: deselect";
  return HELP;
}

// Clicking a vertex: select it, or connect it to the selected vertex. Never removes anything,
// so a habitual double-click is harmless (it used to delete).
export function clickVertex(
  selection: Selection,
  id: number,
  hasEdge: (u: number, v: number) => boolean,
): { selection: Selection; addEdge?: [number, number] } {
  if (selection?.kind === "vertex" && selection.id === id) return { selection: null };
  const next: Selection = { kind: "vertex", id };
  if (selection?.kind === "vertex") {
    // Selection moves on, so clicking vertices one after another draws a path.
    return hasEdge(selection.id, id) ? { selection: next } : { selection: next, addEdge: [selection.id, id] };
  }
  return { selection: next };
}

// A click that adds a vertex reacts at once (Cytoscape's `onetap` waits 250 ms to rule out a
// double click). The second click of a double click is then ignored, so it doesn't add a
// second vertex on top of the first or select the new one.
export const REPEAT_CLICK_MS = 300;
export const REPEAT_CLICK_PX = 8;

export interface Click {
  x: number;
  y: number;
  time: number; // ms
}

export function isRepeatClick(previous: Click | null, click: Click): boolean {
  if (!previous) return false;
  const near = Math.hypot(click.x - previous.x, click.y - previous.y) <= REPEAT_CLICK_PX;
  return near && click.time - previous.time <= REPEAT_CLICK_MS;
}

export type KeyAction = "undo" | "redo" | "remove" | "deselect" | null;

interface Key {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function keyAction(e: Key, selection: Selection): KeyAction {
  const mod = e.ctrlKey || e.metaKey; // Cmd on macOS
  const key = e.key.toLowerCase();
  if (mod && key === "z") return e.shiftKey ? "redo" : "undo";
  if (mod && key === "y") return "redo";
  if (mod) return null;
  if (e.key === "Escape") return "deselect";
  if ((e.key === "Delete" || e.key === "Backspace") && selection) return "remove";
  return null;
}

// Vertices glide to new spots (Arrange, undo) so the user can follow where everything went.
export const MOVE_MS = 450;

export function easeInOut(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c < 0.5 ? 2 * c * c : 1 - (-2 * c + 2) ** 2 / 2;
}

const LINE_HEIGHT = 16; // pixels per wheel "line" (deltaMode 1)

// Zoom factor for one wheel event; a pinch on a touchpad sends many small ones.
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * LINE_HEIGHT : deltaY;
  const clamped = Math.max(-100, Math.min(100, pixels));
  return Math.exp(-clamped * 0.005);
}
