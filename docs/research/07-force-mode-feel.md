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

## 3. Plan and what was done

Written as a plan on 2026-11-05 and done the same day in one pull request, because the tests of step 0 can only pass with steps 1–3 together. Tests are in `js/src/forces.test.ts` and `js/src/widget.test.ts`.

**First try, rejected the same day.** The dragged vertex stayed pinned to the pointer, and `holdBack` stopped it at an edge until the pointer was 48 px past, then put it on the other side. Tried by hand, it felt wrong: the vertex teleported over the edge, and a pinned vertex shoved the edge ahead of it (125 px in one test), after which the edge didn't come back because the pull home faded with the simulation. Dragging one vertex far also didn't pull the graph along like in CS Academy.

**How it was checked.** The real `GraphEditor` runs in headless Chrome with a fake model in place of Jupyter. A script drags vertices with real mouse events over the DevTools protocol and records every vertex's position after each pointer move, plus screenshots. The numbers below come from there. This is a check of our own build, not a replacement for trying it in Jupyter.

**Second try, tuned by hand the same day.** Smoother, but two complaints: a vertex pulled far "kept trying to settle", and crossing an edge was too hard. Recorded frame by frame, the first was real: on release the stretched edge yanked the vertex back 50–90 px, then the pull home dragged it forward again for two seconds. Also a dragged leaf stayed 20+ px behind a still pointer (the tree's edges pulled it back), and vertices piled at the canvas border jittered.

**Third try: measured CS Academy itself.** Still not like CS Academy, so the same scripted drags were run on CS Academy's editor in headless Chrome, recording its vertices (SVG circles) every frame, and then on ours. What CS Academy does:

- The dragged vertex is exactly under the pointer (0–1 px), with nothing slowing it down.
- An edge in its way runs away from it: dragged slowly at an edge, the vertex pushed it 111 px, to the canvas border, and never crossed it.
- Neighbours follow partway: dragging a tree leaf 148 px moved its neighbour 71 px (48%), the rest 0–13 px.
- Everything settles within a quarter of a second of the pointer stopping, and nothing moves after the drop (the dropped vertex "becomes fixed").

Our second try did the opposite on each point: the vertex itself was slowed by edges, and the whole component was let go, so it slid after the pointer for seconds.

**Fourth round, after trying the third by hand.** Two complaints: the graph no longer came along after the dragged vertex ("the picture is almost static"), and holding a vertex on an edge made the picture shake. Both were real:

- The shaking came from d3's `forceManyBody`: its push stops dead at `distanceMax`, so a vertex sitting at that distance was pushed out, felt nothing, came back and was pushed out again. In a test that holds a dodecahedron vertex on one of its edges, vertices travelled 200 px a second back and forth. Replaced by our own short-range repulsion that fades smoothly to nothing (`forceRepel`): 11 px a second, all of it settling, none of it back and forth.
- Following through the edges alone reached only the nearest neighbour, and only slowly (the edges pull through strong friction). Letting the whole component go free (second try) made it follow but slide for seconds. Now the homes of connected vertices move with the drag: a neighbour's by half the drag, the next ones by a quarter, an eighth and so on (`FOLLOW`), and the pull home brings them there quickly.

**Fifth round: a real layout instead of homes.** Tried by hand, two more complaints: holding a vertex on an edge still shook the picture, and the user wants force mode to keep making the drawing tidier, "like Arrange, little by little, evenly spread but keeping our topology", and the graph to come after a vertex pulled far away instead of staying stretched. Homes can't do that: they hold every vertex near where it was. So force mode is now a force-directed layout that keeps the topology, which is exactly what PrEd was made for. Measured on all five demo graphs of `main.ipynb` (dodecahedron, tree, Petersen, K5, path) in headless Chrome:

- Shaking came from d3's `forceManyBody`, whose push stops dead at `distanceMax`. Replaced by our own repulsion that fades smoothly to nothing. Holding a vertex on an edge now shows no back-and-forth motion in any demo graph (the test compares distance travelled with net displacement).
- The first attempt at keeping crossings let them change: in K5 the edges pressed a vertex ever closer to an edge until rounding put it on the other side (1 → 3 crossings), and an edge could swing round and hit a vertex with its far end. Fixed with a 16 px margin and by checking each end of the edge, see below.

**Sixth round: using the canvas.** Tried by hand, the physics felt right, but the tidied drawing was cramped: the dodecahedron shrank to 335 x 351 px in the middle of the 800 x 500 canvas. Two causes, measured in Node and headless Chrome:

- The common edge length was the median edge length of the first layout, which in the dodecahedron is short (75 px). Just taking a longer edge was no fix: the round drawing then hit the top and bottom of the canvas, and the vertices there were pressed against edges.
- Long outer edges, stretched by the drawing inside them, pressed vertices against themselves: in the dodecahedron, Petersen and K5 a vertex ended 16 px from an edge (the closest physics allows). The push off edges was too weak and too short to hold them (0.3, up to 48 px).

Changes: the edge length is now picked so the tidied drawing fills 90% of the canvas in its tighter direction (a copy is tidied first to see how big it gets); a weak pull moves the drawing to the middle of the canvas and stretches it in the other direction, the way the first layout fills the canvas; edges push vertices off harder and from further (1, up to 64 px). Longer-reaching repulsion between vertices was tried too: it barely changed the look, and it pushed the graph away from a dragged vertex instead of letting it follow, so it stays as it was.

| Demo graph | Drawing before | Drawing now | Closest vertex to an edge, before → now |
|---|---|---|---|
| Dodecahedron | 335 x 351 px | 526 x 360 px, centred | 16 → 43 px |
| Petersen | 495 x 468 px, 2 vertices on the border | 524 x 393 px | 16 → 50 px |
| K5 | 325 x 330 px | 447 x 368 px | 16 → 45 px |
| Tree | 768 x 391 px, 6 vertices on the border | 660 x 331 px | 118 → 84 px |
| Path | 553 x 275 px | 648 x 383 px | — |

Holding a vertex on an edge still shows no back-and-forth motion, crossings stay as they were, and after a far pull and drop the rest of the graph comes 60–170 px closer to the dropped vertex (headless Chrome, all five demo graphs).

**Seventh round: trees, edges and the border.** Tried by hand, three complaints: the tree was no longer drawn top-down as before, vertices still came to rest right against edges (a Petersen screenshot), and the drawing could rest pressed against the canvas border. Found with a script that makes six random drags on each demo graph:

- **Trees.** Even spreading turned the first layout's top-down tree into a fan. Now, if force mode starts on a tree drawn in levels (root at the top, each level on one horizontal line, as the first layout and Arrange draw trees), each level is pulled onto one horizontal line and every vertex is kept at least 48 px below its parent. So the tree stays top-down and only spreads sideways, and dragging any vertex brings the whole tree after it, upright. Before the second rule, dragging the root through the tree folded it, with lower levels above upper ones. A path drawn as a slanted line has one vertex per level and is left alone.
- **Vertices stuck on edges.** The crossing guard (PrEd) cancelled a vertex's whole move if any part of it went towards a nearby edge, so a vertex between two edges could not move at all, and a vertex an edge had been dragged over stayed on it (3 px from it in the dodecahedron). Now only the part of the move aimed at the edge is limited; that still never lets anything cross, because the distance to a segment shrinks by at most that part. Physics also keeps edges at least two radii from a vertex's centre now, so a line passes a circle with a radius of space instead of touching it.
- **Border.** A vertex only stopped at the border; now vertices closer than 16 px to it are pushed back in.
- **Squeezed after a drop.** A vertex dropped near the border pulled the graph after it, and since the pull to the middle is off while a dropped vertex is held (so the graph comes after it), the drawing stayed squeezed. Now, after a drop, the drawing is stretched where it fills less than 60% of the canvas, without being moved. Stretching it all the way to 90% kept the edges to a vertex pulled far away stretched, which is what the user asked to avoid.

After six random drags no vertex in any demo graph is closer than 32 px to an edge, except a dropped vertex held next to an edge whose ends are at the border (26 px). Holding a vertex on an edge still shows no back-and-forth motion, crossings stay as they were, and after a far pull and drop the rest of the graph comes 55–170 px closer.

**Eighth round: Arrange, grabbing, zooming out.** Three more complaints after trying it by hand:

- **Arrange jumped.** The vertices glided to Python's new layout, and force mode then moved them all again (up to 85 px), so the drawing first looked compact and then jumped. The same happened when the editor opened. Now the new layout is tidied at once on a copy, and the vertices glide straight to the tidied drawing; when the editor opens, it shows the tidied drawing right away. Afterwards physics has nothing left to do: 0 px of movement in the browser. The simulation then counts as cooled down: it was still at d3's starting alpha of 1, which made the first grab move the whole graph up to 88 px.
- **Touching a vertex pulled all edges together.** The pull that stretches the drawing over the canvas was switched off while a vertex was held, and since that pull holds the drawing against its edges, the whole graph shrank at once (dodecahedron 526 → 411 px wide). Now only the move to the middle is off while a vertex is held or dropped; the stretch stays, recomputed from the drawing every tick and at most 1.3 times. Two versions that didn't work: keeping the stretch from the moment before the grab was unstable (a drawing that grew a little was pushed to grow more, until it hit the border), and stretching around the middle of the drawing's box moved the whole drawing sideways (45 px) once the move to the middle was off; it is now around the mean position of the vertices that aren't held. Holding a vertex still now moves the others by up to 10 px.
- **Zoomed out, vertices stayed in the canvas rectangle**, so the graph couldn't be moved into the space around it. Now a dragged vertex may go anywhere in the canvas or the visible area, whichever is bigger, and its position in Python can then be outside [0, 1]. Physics keeps vertices in the canvas grown to take in every vertex where it was put (worked out again when a vertex is dragged, loaded or arranged), not in the visible area: a first version let the border follow the view, and scrolling down or zooming in then pushed the graph along (the user: nonsense; a border the graph is dragged against is fine).

**Ninth round: a grabbed leaf sent the tree flying.** Grabbing one leaf of the tree made the whole tree drift up, 70 px in two seconds and still going. Two causes, each found by switching forces off one at a time in a script:

- d3's edge springs (`forceLink`) give the end with fewer edges the bigger share of each pull, so their pulls don't add up to zero. In a tree (leaves have one edge, the others three) that leaves a steady push one way, which the pull to the middle of the canvas had been cancelling; since the eighth round that pull is off while a vertex is held. The springs are now our own (`forceSprings`): same strength as d3's, shared equally between the two ends. Graphs whose vertices all have the same number of edges (dodecahedron, Petersen, K5) behave exactly as before.
- A held vertex was left out of its level. But the level had been holding that leaf against its edge, and without it the rest of the level gave way. Now a held vertex counts for its level at the height it was grabbed at.

Holding a leaf still for two seconds now moves the rest of the tree by up to 12 px (headless Chrome), and the settled tree looks as before.

Then the tree could go past the canvas. During a drag, the room physics keeps vertices in was worked out again from every vertex, with a 16 px margin, on every pointer move; wherever physics pushed a vertex against the border (a parent pushed up by a child dragged above it), the border moved out 16 px more, and the graph walked off. Also, vertices 20 px from the edge, where the first layout puts them, already grew the room past the canvas. Now during a drag only the dragged vertex grows the room, and only vertices sticking out of the canvas grow it at all. Dragging a leaf of the tree to the top and wiggling it there for three seconds keeps every vertex on the canvas.

**What force mode does now**

- **It is a layout, not a spring back to fixed spots.** Every edge pulls towards one common length (both ends equally), vertices closer than 2.5 edge lengths push each other apart, fading smoothly to nothing, and vertices are pushed off edges they aren't part of (up to 64 px away). The drawing drifts towards an even, tidy one; the simulation cools over about 8 seconds, so this happens little by little.
- **It uses the canvas.** When force mode starts (and after Arrange), a copy of the drawing is tidied first to see how big it gets, and the common edge length is set so the tidied drawing fills 90% of the canvas in its tighter direction. A weak pull also stretches it in the other direction (at most 1.3 times) and, while no vertex is held or dropped, moves it to the middle.
- **Opening the editor and Arrange show the tidied drawing straight away**: the vertices are placed (or glide) where force mode would take them, so nothing moves afterwards. After Arrange the view also glides, keeping its zoom, so the redrawn graph is in the middle of what the user sees (the user, 2026-11-05). The view moves, not the vertices: moving the vertices into the view would fight the pull to the middle of the canvas. On big graphs the trial is cut short so turning force on doesn't hang (a 225-vertex grid: 0.4 s), and it guesses the size less exactly.
- **Trees drawn in levels stay drawn in levels**: each level on one horizontal line, every vertex at least 48 px below its parent.
- **The topology is kept (PrEd).** Each tick, a vertex may come at most half of the distance minus 32 px closer to an edge it isn't part of, and so may each end of the edge come towards the vertex; the rest of each move is kept. So no vertex passes over an edge and no edge over a vertex, and the crossings stay what they were: 0 for the planar demo graphs, 2 for Petersen, 1 for K5, also under random kicks in a test. Moving away is never limited, so nothing gets stuck next to an edge. Only a vertex dragged by hand can change the crossings; a drawing tangled that way stays tangled until Arrange.
- **The dragged vertex is held exactly under the pointer** (0–1 px), as in CS Academy. Edges and vertices in its way move aside: dragged slowly at an edge, the vertex pushes it ahead (133 px in the test) instead of crossing it; a quick move still gets across.
- **The graph comes after it**: its edges pull their neighbours, and theirs. Dragging a tree leaf 250 px moved the rest of the tree 90–120 px during the drag.
- **After the drop the vertex stays where it was dropped** until the simulation cools down, and the rest of the graph comes closer and settles around it, as in CS Academy. The physics restarts warmer after a drop (alpha 0.5).
- **At the border** a vertex stops instead of keeping its speed into it, and vertices closer than 16 px to it are pushed back in. For physics the border is the canvas, grown to take in vertices dragged past it; a dragged vertex may go anywhere in the canvas or the visible area. Scrolling and zooming never move vertices.
- Frozen mode does not change: the vertex goes exactly where it is dropped.

This replaces the gentle mode decided on 2026-10-23 ([research/03](03-existing-editors.md)): turning force on no longer leaves the first layout almost unchanged (vertices of the demo graphs move up to 40–290 px), but it keeps its crossings, which is what the first layout is for. Vertices pushed aside by a drag no longer spring back to their old spots; they settle wherever the layout puts them.

**Known:** PrEd improves a drawing locally; it doesn't search for the best drawing with the same crossings, and a drawing tangled or squeezed by drags stays that way (only stretched back to 60% of the canvas) until Arrange, which redraws from scratch. In a tree, dragging the root to the bottom of the canvas can't keep the tree upright: there is no room below it.

**Open:** CS Academy keeps a dropped vertex fixed until it is clicked; ours keeps it fixed only until the physics cools down (about 8 seconds). Ask the team whether fixed vertices (with a click to unfix) are wanted.

**Not planned for now: curved edges** like CS Academy's. Cytoscape.js can draw them, but the first layout counts crossings for straight edges, so curves would make our "0 crossings" claim harder to check by eye.

## Sources

- CS Academy graph editor: https://csacademy.com/app/graph_editor/ (observed 2026-11-05)
- PrEd: F. Bertault, "A force-directed algorithm that preserves edge crossing properties", Information Processing Letters 74 (2000)
- d3-force simulation parameters: https://d3js.org/d3-force/simulation
