# Landscape review: build or adopt?

Date: 2026-10-23. Question: for each part of the project, does a mature existing solution exist that we should use instead of our own code? Versions and licences were checked on npm and PyPI on this date.

## 1. Existing Jupyter graph widgets

| Project | Status | Edit on the canvas? | Notes |
|---|---|---|---|
| anywidget-graph (Sigma.js) | 0.4.6, Oct 2026, Apache-2.0 | No: drag, pin, zoom, select; nodes and edges added only from Python | Closest relative. Useful as a reference for an anywidget + JS-library design |
| yFiles Graphs for Jupyter | 2.0.0, Aug 2026, proprietary free licence | No, a viewer with layouts | Can't be built on (closed licence) |
| ipysigma | 0.24.6, Nov 2025 | No, a viewer | |
| ipycytoscape | 1.3.3, Apr 2022, BSD | Limited | Unmaintained |
| graphviz-anywidget, pyvis, netwulf | various | No | Viewers or exporters |

**Conclusion:** no existing widget offers what the professor asked for: editing on the canvas, a force/freeze toggle, and a crossing-minimizing first layout, synced back to NetworkX. The project has a real gap to fill. We can, however, use a JS library for the drawing part.

## 2. Drawing and interaction in the browser

| Library | Latest | Licence | What it gives us | Concerns |
|---|---|---|---|---|
| **Cytoscape.js** | 3.34.4, Oct 2026 | MIT | Canvas rendering, **labels on vertices and edges**, styling from data (colours from attributes), selection, box select, **zoom and pan**, events, many layouts and extensions. About 8 million downloads a week | Editing gestures are ours to write (or use `cytoscape-edgehandles`, MIT, last release 2021). Some third-party blogs wrongly call it LGPL; npm says MIT |
| vis-network | 10.1.2, Aug 2026 | Apache-2.0 or MIT | Built-in editing toolbar (add or edit nodes and edges via callbacks), built-in physics | Its physics is a full re-layout (the behaviour we rejected). Generic toolbar look. 84 MB package |
| AntV G6 | 5.1.1, May 2026 | MIT | Large framework with many behaviours and layouts | Heavier, more to learn |
| Sigma.js + graphology | 4.0.3 / 0.26.0 | MIT | WebGL, thousands of nodes | Made for big read-only graphs |
| **Our own SVG + d3-force** (current) | d3-force 3.0.0 | ISC | Full control. Gentle force mode, dragging and editing already work and are tested | Labels, edge labels, zoom/pan, colours and styling would all be written by us |

**Assessment:** Cytoscape.js covers most of what is still missing: labels, edge labels, colours from attributes, zoom/pan, selection styling. Our physics (`forces.ts`) can keep running and feed positions into Cytoscape, so the gentle force mode stays. Our Python first layout is not affected. Cost: rewriting the drawing part of `widget.ts` (about 300 lines). Most of the rest (messages to Python, physics, tests) stays.

## 3. Physics: vertices on top of edges

Issue found by testing: a vertex can be dropped onto an edge (vertex 4 on edge 3-2), so three edges overlap. Our physics only pushes vertices away from vertices.

| Method | Idea |
|---|---|
| PrEd (Bertault, 2000) | Adds a repulsive force between each vertex and each edge it is not part of, and limits how far each vertex may move per step so it never jumps across an edge. Keeps the crossing structure of the drawing |
| ImPrEd (Simonetto et al., 2011) | Faster, less restrictive version of PrEd |
| Davidson-Harel (1996) | Vertex-edge distance term in the energy. Already used in our first layout (research/04) |
| Edge-edge repulsion (2012 paper) | Improves angles between edges, but can make vertices overlap, so it is combined with vertex repulsion |

**Plan:** add a PrEd-style vertex-edge repulsion force to `forces.ts` (force mode), with a regression test: a vertex placed on an edge must be pushed off it. In frozen mode nothing moves by design, so there the user decides. A visual hint (highlighting a vertex that sits on an edge) could be considered later.

## 4. First layout (Python)

| Part | Existing solutions | Decision |
|---|---|---|
| Planarity test, planar drawing | NetworkX `check_planarity`, `planar_layout` | Already used |
| Nice planar drawings | Tutte embedding, Kamada-Kawai, spring layouts | Already used, with candidate selection |
| Crossing minimization | OGDF (C++, 91 MB package, no macOS build), igraph Davidson-Harel (GPL), SPX (needs commercial CPLEX) | None usable as-is; our implementation combines their ideas. See research/04 |
| Big graphs | Graphviz sfdp, OGDF FMMM | Not needed for course-size graphs |

## 5. Labels and attribute editing

- **Display:** Cytoscape.js draws vertex and edge labels and maps colours from data. With our own SVG we would write text placement, edge-label placement and colour mapping ourselves.
- **Editing:** existing tools use either a toolbar with callbacks (vis-network) or a side panel for the selected item (the old version of this project, yFiles). A side panel inside our widget fits the requirement ("click a vertex or edge and edit its attributes").

## Recommendation

| Part | Recommendation |
|---|---|
| Jupyter integration | Keep anywidget and our Python `GraphWidget` |
| First layout | Keep ours (no usable library) |
| Physics | Keep our d3-force gentle mode, add PrEd-style vertex-edge repulsion |
| Drawing, labels, zoom/pan, styling | **Switch to Cytoscape.js** before building labels, instead of writing labels, edge labels, zoom/pan and styling ourselves |
| Editing gestures | Keep our click-click and double-click behaviour, implemented on Cytoscape events |
| Attribute editing | Side panel in the widget |

**Decided (2026-10-23):** switch the drawing part to Cytoscape.js, and add PrEd-style vertex-edge repulsion to force mode.

## Sources

- PrEd and ImPrEd: https://diglib.eg.org/handle/10.1111/v30i3pp1071-1080 , survey: https://arxiv.org/pdf/1201.3011 , Sprouts paper: https://arxiv.org/pdf/2108.07671
- Edge-edge repulsion: https://ir.lib.nycu.edu.tw/handle/11536/15668
- Library comparisons: https://www.pkgpulse.com/blog/cytoscape-vs-vis-network-vs-sigma-graph-visualization-javascript-2026 , https://npmtrends.com/@antv/g6-vs-@antv/graphin-vs-cytoscape-vs-d3.js-vs-vis-vs-visjs-network-vs-webcola
- vis-network editing: https://visjs.github.io/vis-network/docs/network/manipulation.html
- cytoscape-edgehandles: https://github.com/cytoscape/cytoscape.js-edgehandles
- WebCola: https://ialab.it.monash.edu/webcola/
- anywidget-graph: https://github.com/GrafeoDB/anywidget-graph
- yFiles Graphs for Jupyter: https://www.yworks.com/products/yfiles-graphs-for-jupyter
- ipysigma: https://github.com/medialab/ipysigma
- graphviz-anywidget: https://github.com/pipefunc/graphviz-anywidget
