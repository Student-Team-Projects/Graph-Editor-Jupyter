# Force mode feel: resisting crowding and edge crossing

Date: 2026-11-05. Question: the professor wants force mode to feel like CS Academy's (see "Force mode feel" in [requirements](../requirements.md)). Vertices should resist being pushed close together, and a vertex should not slip across an edge easily. What does CS Academy do, why does our force mode not do it, and what do we change?

## 1. What CS Academy does

Observed in its editor (https://csacademy.com/app/graph_editor/) on 2026-11-05, Force mode, 6 vertices of radius about 19 px.

| Action | What happened |
|---|---|
| Drop a vertex on top of another | It ended about 55 px (centre to centre) from it, and the neighbours moved away too. Every vertex repels every other one, and a pull draws the whole graph to the centre of the canvas, not to where each vertex was. |
| Drop a vertex on the middle of an edge | The dropped vertex stayed put: it becomes fixed when dropped (their help text says so; a click unfixes it). **The edge moved instead:** one endpoint was pushed about 30 px away. |
| Edges near a vertex | Drawn as curves that bend around the vertex (quadratic paths in the SVG) instead of straight lines through it. |

So in CS Academy the *other* things yield: vertices move away and edges move or bend around the vertex. Nothing rests on top of anything.

## 2. Why our force mode does not do it

All numbers are in `js/src/forces.ts`.

| Setting | Value | Effect |
|---|---|---|
| `velocityDecay` (friction) | 0.5 (d3 default 0.4) | Removes half the speed every tick. Changes only *how fast* things settle, not where. |
| `charge` | −150, only up to 80 px (`PERSONAL_SPACE`) | Vertices further apart than 80 px don't push each other at all. |
| `collide` | radius r + 12.8 px | Vertices stop at 57.6 px between centres and are then left alone. |
| `forceVertexEdge` | 40 px (`EDGE_CLEARANCE`), push 0.5 | Pushes **only the vertex**. The edge never moves, so nothing pushes back against a dragged vertex. |
| `HOME_PULL` | 0.08 | Pulls every vertex back to where it was. Fights everything that would spread vertices out. |
| Dragging | `fx`/`fy` pinned to the pointer | The dragged vertex follows the pointer exactly. No force can slow it down, so crossing an edge costs nothing. |

The gentle setup was chosen on 2026-10-23 so that turning force on does not scramble the crossing-free first layout ([research/03](03-existing-editors.md)). The new requirement changes that balance.

Measured with the real `forces.ts`, simulating a 0.5 s drag and the release the way `widget.ts` does it. Distances are between centres in px; vertices touch at 32 px, and a vertex touches an edge at 16 px.

| Situation | Now | Friction 0.3 | `HOME_PULL` 0.03 | Edge pushed back too | Edge pushed back, 56 px reach |
|---|---|---|---|---|---|
| Dropped on a vertex | 61 | 62 | **80** | 61 | 62 |
| Dropped on an edge (distance to the edge) | 35 | 35 | 38 | 36 | **51** |
| Dropped in the middle of K4 (distance to an edge) | **24** | 24 | 25 | 28 | 30 |
| 6 vertices stacked, then Arrange | 58 | 58 | 58 | 58 | 58 |

Findings:

- **Friction is not the cause.** With less friction vertices only move faster and stop in the same places.
- **`HOME_PULL` holds vertices together most.** Weakening it spreads crowded vertices noticeably further.
- **A vertex trapped among edges stays trapped.** Pushes from the edges around it cancel out, and physics can't carry it out through an edge. Letting edges be pushed back helps only a little. This is why item 2 of the requirement needs a change to *dragging*, not just stronger forces.

## 3. Plan

Target: show it at the meeting on 2026-11-26. Each step is its own pull request with tests in `js/src/forces.test.ts`, and is checked by hand in `main.ipynb`.

**Step 0. Tests that describe the wanted feel** (before any tuning, so the tuning has a target)
- Drop a vertex on another vertex: they end at least about 70 px apart.
- Drop a vertex on an edge: it ends at least about 45 px from the edge.
- Drag a vertex steadily across an edge: it stays on its own side until the pointer is clearly past the edge.
- Keep the existing guards: turning force on leaves the crossing-free first layout with 0 crossings, and vertices move only a little (today: less than 40 px).

**Step 1. Vertices keep their distance** (small, numbers only)
- `HOME_PULL` from 0.08 to about 0.03–0.04, and a larger `collide` radius and charge reach.
- Cost: the drawing drifts further from the first layout after edits. The "first layout almost unchanged" test may need a looser bound, to be agreed by the team.

**Step 2. Edges push back** (PrEd, already chosen in [research/05](05-landscape-review.md) but only half done)
- `forceVertexEdge` also pushes the edge's two endpoints the opposite way, split by where the vertex is along the edge, and reaches about 56 px instead of 40 px.
- PrEd's second rule, which we skipped: limit how far a vertex may move in one tick so the simulation itself never moves a vertex across an edge.
- Cost: a little more movement of vertices that weren't touched, and one more loop over the edges per tick (fine for teaching-size graphs).

**Step 3. Dragging across an edge is harder** (the main change)
- While dragging in force mode, the vertex is no longer pinned to the pointer (`fx`/`fy`). It is pulled towards the pointer by a strong spring instead, so edge repulsion can hold it back. Near an edge it sticks to its side; once the pointer is far enough past the edge, it jumps across.
- Frozen mode does not change: there the vertex goes exactly where it is dropped.
- Cost: the vertex lags behind the pointer near edges, which can feel sluggish. The spring and the threshold need tuning by hand, so we should try it with the team first.
- **Open:** after release, should the dropped vertex stay fixed like in CS Academy, or rejoin the simulation like now?

**Not planned for now: curved edges** like CS Academy's. Cytoscape.js can draw them, but the first layout counts crossings for straight edges, so curves would make our "0 crossings" claim harder to check by eye. Reconsider after step 3.

## Sources

- CS Academy graph editor: https://csacademy.com/app/graph_editor/ (observed 2026-11-05)
- PrEd: F. Bertault, "A force-directed algorithm that preserves edge crossing properties", Information Processing Letters 74 (2000)
- d3-force simulation parameters: https://d3js.org/d3-force/simulation
