# Tech stack research

Date: 2026-10-23. Versions checked on PyPI and npm on that date.

## Recommendation in short

Rebuild the editor as a **Python package with a TypeScript front end**, using **anywidget**:

- **Python** keeps the user-facing API (`edit(graph)`), converts NetworkX graphs, and computes the first layout (planarity, crossing minimization). This code is easy to test with `pytest`.
- **TypeScript** draws the graph and handles all interaction in the browser: dragging, force mode on/off, selection. Physics runs in the browser, not in a Python thread.
- **anywidget** connects the two halves and runs the same widget in JupyterLab, classic Notebook, VS Code, Google Colab and marimo.

Start a fresh codebase in the same repository, keeping the old code under a git tag. Details and the alternative are at the end.

## Why change the architecture

Today every frame is drawn in Python and sent to the browser (see [assessment](01-current-code-assessment.md)). Moving drawing and physics into the browser:

- makes dragging and physics smooth, with no kernel round-trip per frame,
- removes the fragile background thread,
- makes VS Code and Colab support realistic (the team's idea),
- lets the same TypeScript code run as a plain web page (a CS Academy-style demo) if we want one later.

## Options for connecting Python and the browser

| Option | Notes | Verdict |
|---|---|---|
| **anywidget** 0.11.0 (Apr 2026) | Python class plus one ES module file. State synced with traitlets (`model.get`, `model.set`, `save_changes`). Runs in JupyterLab, Notebook, VS Code, Colab, marimo. Official template `npm create anywidget@latest` sets up TypeScript with esbuild and builds the JS into the Python package. Hot reload with `ANYWIDGET_HMR=1`. Types in `@anywidget/types` 0.4.0. | **Recommended** |
| Classic ipywidgets custom widget (TypeScript cookiecutter) | The older official way. Much more boilerplate and a separate JupyterLab extension build. | Not worth it now that anywidget exists |
| Keep ipycanvas + ipyevents (current) | Pure Python, no JS to learn. Drawing over the kernel stays slow. VS Code support is uncertain (the README already warns about it). | Only if the team refuses to use TypeScript |
| JupyterLab extension | Changes JupyterLab itself. Wrong tool: we need a widget in a cell, not a new menu. | No |

## Options for drawing the graph in the browser

> **Update 2026-10-23:** drawing switched to **Cytoscape.js**, keeping d3-force for physics. Reason: labels, edge labels, colours, zoom and selection come ready-made. See [05-landscape-review.md](05-landscape-review.md).

| Library | Latest | Fit for us |
|---|---|---|
| **d3-force** + our own SVG drawing | 3.0.0 (2021, stable and widely used) | Gives exactly the CS Academy behaviour: a force simulation you can start and stop (freeze), and `fx`/`fy` to pin a dragged vertex. We control the look completely. Small. **Recommended.** |
| Cytoscape.js | 3.34.4 (Oct 2026) | Full graph-viz library with many layouts and styling. Heavier, and its own interaction model fights a simple editor. A good fallback if we need a lot of features fast. |
| sigma.js + graphology | 4.0.3 / 0.26.0 | WebGL, built for thousands of nodes. Overkill for course-size graphs and harder to customize for editing. |
| vis-network | 10.1.2 (Aug 2026) | Has built-in physics and editing. Look and behaviour are harder to control. |

SVG is enough for graphs up to a few hundred vertices. If we need more, the same d3-force code can draw to a canvas instead.

## First layout: crossing-free or few crossings

This is the professor's most "algorithmic" requirement. Compute it in Python, where NetworkX is available and testing is easy, and send the coordinates to the front end.

**Planar graphs (no crossings):**
- `nx.check_planarity(G)` returns `(is_planar, embedding)`. Use the first element (the current code doesn't, see the assessment).
- `nx.planar_layout(G)` gives straight-line, crossing-free positions for **any** planar graph, including trees and cycles. The drawing is correct but often cramped.
- To make it nicer: use the Tutte embedding (already in the old code) when the graph is 3-connected, and otherwise improve positions with a force step that **rejects any move creating a crossing**.

**Non-planar graphs (few crossings):**
- Finding the minimum number of crossings is NP-hard, so we need a heuristic.
- Simple plan: compute several candidate layouts (spring, Kamada-Kawai, spectral, several random seeds), count crossings with a sweep or a simple O(E²) check, keep the best, then improve it with local search (move one vertex at a time to a spot that lowers the crossing count).
- Stronger option: **planarization**, the method graph-drawing research considers best in practice. It is implemented in OGDF (C++). Python bindings exist: `ogdf-py` 0.5.1 (Sep 2026, needs a local C++ build) and `ogdf-python` 0.3.5. A heavy dependency for a course project, so research it, and use it only as an optional extra.
- Write tests: known graphs with known crossing numbers (K5 = 1, K3,3 = 1, Petersen = 2) give a clear target for the report.

## Other tools

| Purpose | Tool |
|---|---|
| Python packaging | `pyproject.toml` with hatchling (what the anywidget template uses) |
| Python tests | pytest |
| Python lint and format | ruff |
| TypeScript bundling | esbuild (template default), or Vite with `@anywidget/vite` |
| TypeScript tests | vitest (optional) |
| Automatic checks on every pull request | GitHub Actions running tests and lint |

## Existing alternatives, for the report

| Project | Status | Why it doesn't already solve the task |
|---|---|---|
| ipycytoscape | Last release 1.3.3 in April 2022 | Viewer more than editor, no crossing-free layout, apparently unmaintained |
| ipysigma | 0.24.6 (Nov 2025) | Viewer for large graphs, not an editor |
| pyvis | 0.3.2 (Feb 2023) | Generates static HTML, clicks don't go back to Python |
| gravis | 0.1.0 (Dec 2021) | Viewer, inactive |

None combines editing, a freeze/force toggle and a crossing-minimizing first layout. That gap justifies the project.

## Decision: rewrite or fix?

**A. Rewrite (recommended).** New package structure in the same repo: Python core + TypeScript widget. Tag the current state as `legacy-v0.0.6` so nothing is lost.
- For: the confirmed bugs sit in the parts we would replace anyway. The architecture itself (Python drawing in a thread) is the main weakness. The old code is only about 1300 lines, so rewriting is affordable. It matches the TypeScript idea and gives VS Code support.
- Against: we must learn TypeScript and anywidget. Nothing works until the first version is built. (The professor confirmed a rewrite is fine.)
- What we reuse: the `edit(graph)` API, the label editing idea, the Tutte embedding code.

**B. Fix in place.** Keep Python and ipycanvas, fix the bugs, split `edit.py`, add tests, add the layout features.
- For: no new language, always a working version.
- Against: keeps the slow architecture, VS Code stays uncertain, and much of the cleanup effort goes into code we might replace later.

A middle path is possible: write the new Python layout module (planarity and crossing minimization) with tests first. It is needed in both A and B, so it is useful while the team decides.

## Decided (2026-10-23)

- **Option A, rewrite.** The professor accepts a rewrite, and the whole team agrees to use TypeScript.
- **Scope:** the three required behaviours in [requirements](../requirements.md). Directed and weighted graphs only later, if quick.

## Sources

- anywidget docs: https://anywidget.dev/en/getting-started/ and https://anywidget.dev/en/bundling/
- anywidget on PyPI: https://pypi.org/project/anywidget/
- OGDF Python bindings: https://pypi.org/project/ogdf-py/ and https://pypi.org/project/ogdf-python/
- ipycytoscape on PyPI: https://pypi.org/project/ipycytoscape/
- Crossing minimization overview: https://arxiv.org/pdf/1804.09900v2
- d3-force: https://d3js.org/d3-force
