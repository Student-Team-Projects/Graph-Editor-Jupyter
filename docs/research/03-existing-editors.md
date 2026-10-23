# Existing graph editors: how they behave

Date: 2026-10-23. Purpose: copy the conventions users already know, so our editor feels familiar.

## Tools looked at

| Tool | What it is | Notes |
|---|---|---|
| CS Academy graph editor | Web editor, our reference | Force mode (animated "gravitational pull") and draw mode, where the pull stops so editing is easier. Graph can also be typed in a table/text area on the left. Launched supporting up to 30 nodes; no loops at launch. Users asked for a "freeze" checkbox to fix positions, and CS Academy said it was not a priority. |
| d3 "Directed Graph Editor" (rkirsling) | Classic open-source d3 editor | Click empty space adds a node. Drag from node to node adds an edge. Click selects, Delete/Backspace removes. While dragging, the node is fixed to the pointer and the simulation is reheated so neighbours react; on release the node is freed and the graph settles. |
| d3-force examples (Observable) | Reference code for force layouts | Drag pattern: set `fx`/`fy` on drag start, follow the pointer, clear on drag end. "Sticky" variant: don't clear on drag end, so released nodes stay pinned. Setting `fx`/`fy` to null unpins. |
| netwulf | Python library: NetworkX graph in a d3 force view in the browser | Returns the layout and style to Python when you click "Post to Python". Viewer and stylizer, not an editor. |
| EonGraph, DSC Force Graph | Small open-source force-directed editors | Add, edit and delete nodes, JSON import/export. |

## Common conventions

**Editing:**
- Click empty space: add a vertex there.
- Edge creation: either drag from vertex to vertex, or click one vertex and then another. Click-click is easier on touchpads.
- Click to select. Delete/Backspace removes the selection. Removing a vertex removes its edges.

**Dragging:**
- Edges are straight lines between vertex centres, so they stretch, shrink and rotate to follow a dragged vertex. Nothing else happens to edges.
- **Frozen / draw mode:** only the dragged vertex moves. All other vertices stay exactly where they are. On release the vertex stays where it was dropped.
- **Force mode:** the dragged vertex is held under the pointer (pinned), and the simulation is reheated so other vertices are pushed away and pulled by their edges. Tools differ on what happens on release:
  - *Free on release* (d3 default, rkirsling): the vertex rejoins the simulation and may drift.
  - *Sticky* (d3 sticky variant): the vertex stays pinned where dropped until unpinned, for example by double-clicking it.

**Switching modes:**
- Force → frozen stops the simulation, and every vertex keeps its current position.
- Frozen → force restarts the simulation from the current positions. The layout is not reset.

## Decided (2026-10-23)

- **Frozen mode:** the dragged vertex follows the pointer, edges follow, nothing else moves. It stays where dropped.
- **Force mode is gentle** (changed after testing, 2026-10-23). A full force re-layout scrambled crossing-free drawings (dodecahedron: 0 → 10 crossings, vertices jumping 270 px). Now, when force turns on, every edge keeps its current length as its natural length, every vertex keeps its current spot as home, vertices only push each other when closer than about 80 px, and a weak pull returns them home. Measured on the dodecahedron: 0 crossings after, vertices move at most 18 px.
- **Dragging in force mode:** the dragged vertex is pinned to the pointer and nearby vertices get pushed aside. **On release it rejoins the simulation with the drop spot as its new home**, and the pushed vertices spring back to theirs.
- **New edge:** click one vertex, then another (not drag from vertex to vertex), so dragging always means moving.
- Switching modes never resets the layout.
- **Force is on when the editor opens** (team decision, 2026-10-23; before that it started frozen). Gentle force mode keeps the first layout's crossings, so starting with it costs nothing and shows the physics right away.

## Implementation notes

- Implement it with d3-force: `simulation.stop()` for frozen mode, `alphaTarget(...).restart()` while dragging in force mode, `fx`/`fy` for pinning.
- A freeze toggle is something CS Academy's own users asked for and never got, which is a point for the report.

## Sources

- CS Academy launch post and comments: https://codeforces.com/blog/entry/45758
- Directed Graph Editor: https://gist.github.com/rkirsling/5001347
- d3-force docs: https://d3js.org/d3-force
- netwulf: https://pypi.org/project/netwulf/
- EonGraph: https://github.com/ProgramIsFun/EonGraph-Web
- DSC Force Graph: https://github.com/UyLeQuoc/dsc-force-graph
