# Arrange for looks: symmetric drawings next to fewest crossings

Date: 2026-11-23. Question: some graphs look poor when drawn with the fewest crossings, the Petersen graph for one, although the drawing is correct. Roman Volochai proposed giving Arrange a choice: fewest crossings, or looks. How should "looks" be drawn, and what does force mode do with such a drawing?

## Decision

Decided by Roman Volochai on 2026-11-23 (recorded under "Layout priority" in [requirements](../requirements.md)):

- **Arrange opens a small menu: "Fewest crossings" or "Looks".** Fewest crossings is the algorithm of the first layout, unchanged. The first layout itself is still fewest crossings first. In Python: `widget.arrange(mode="crossings" | "looks")`.
- **Looks** goes for symmetric, even drawings, and accepts more crossings for them. Planar graphs still get no crossings, and trees keep the layered drawing of the first layout.
- **After Arrange for looks, nothing moves until a vertex is touched**; then force mode tidies as usual (since 2026-11-26; before, force mode kept the drawing's shape, see below).

The test case is the circulant graph C24(1, 5, 7, 11), added to `main.ipynb`. Drawn with the fewest crossings the search finds (216), it is a tangle. With its vertices evenly on a circle (1152 crossings), it looks like a carpet pattern.

## How Looks draws a graph

`src/graph_editor_jupyter/looks.py`. Each connected component gets several candidate drawings, and the one with the best looks score wins. Components are packed onto the canvas as in the first layout.

**Candidates**

- **Drawings that show a rotational symmetry of the graph.** The automorphisms of the graph are searched, with a time limit of 0.4 s:
  - first shifts of the vertex order. They are cheap, and they find the symmetry at once for graphs built as circulants or from LCF notation;
  - then whatever NetworkX's VF2 matcher finds in the time left.

  An automorphism whose cycles all have the same length k ≥ 3 can be drawn as a rotation. At most one vertex may stay fixed; it goes in the middle. Each cycle goes on a ring, and each step of the automorphism turns the drawing by 360/k degrees. Ring radii and turns are fitted to the graph distances (stress, with an analytic gradient). Rings are also not allowed closer than 0.6 edge lengths: stress alone squeezed the inner ring of the dodecahedron. Variants turn the rings against each other by multiples of 180/k degrees, which also gives mirror symmetry where the graph has it.

  One cycle through every vertex gives a circle (the carpet). The Petersen graph gives a pentagon around a pentagram. This is the automatic form of "known constructions": no list of named graphs is needed.
- **Circles.** One with the vertices in their given order, and one with an order chosen to cut crossings: by the angle of each vertex in the plane of the Laplacian's second and third eigenvectors, then single moves while they remove crossings.
- **Kamada–Kawai.**
- **For planar graphs:**
  - the crossing-free first layout;
  - Tutte's drawing, also pulled out from its middle (distance from the centre r becomes r^p for p = 0.8, 0.65, 0.5). Tutte's drawing crowds the inner faces, and this spreads them while keeping the symmetry.

**Looks score** (lower is better):

- **symmetry: −log(shown symmetry).** The symmetry is measured on the drawing itself, so every candidate is judged the same way. It counts the rotations and mirror images about the centre of mass that map vertices onto vertices and edges onto edges. The Petersen graph as a pentagon around a pentagram scores 10: 5 turns and 5 mirror images.
- **crossings: + log(1 + crossings) − log(1 + the fewest any candidate has).** This is a log scale: going from 200 to 1000 crossings in a dense graph matters less than going from 0 to 5.
- **uneven edge lengths:** + their coefficient of variation.
- **crowded edges:** + how far the smallest angle between edges at a vertex falls short of an even spread. Of two equally symmetric drawings of the Möbius–Kantor graph, this picks the one with spokes straight out from the middle.
- **near-misses:** + 2 log(1 + count), where a near-miss is a vertex on top of another or on an edge.

Planar graphs only consider crossing-free candidates, as in the first layout.

**Upright.** A winner with symmetry 3 or more is turned so that as many edges as possible run level or upright. A grid then comes out square, not as a diamond. If no turn helps, a vertex points straight up (Petersen, K5).

## Measurements

Shown symmetry and crossings for both modes, on the 800 × 500 canvas. Looks times were measured on the development machine.

| Graph | Fewest crossings: crossings, symmetry | Looks: crossings, symmetry | Looks time |
|---|---|---|---|
| Dodecahedron | 0, 10 | 0, 10 | 0.2 s |
| Petersen | 2, 1 | 5, 10 | 0.1 s |
| K5 | 1, 1 | 5, 10 | 0.0 s |
| Carpet C24(1,5,7,11) | 216, 1 | 1152, 48 | 0.7 s |
| Cube | 0, 8 | 0, 8 | 0.0 s |
| Heawood | 3, 1 | 14, 14 | 0.1 s |
| K3,3 | 1, 1 | 3, 12 | 0.0 s |
| Möbius–Kantor | 4, 1 | 16, 16 | 0.1 s |
| Desargues | 9, 1 | 20, 20 | 0.2 s |
| Grid 4×4 | 0, 4 | 0, 8 | 0.1 s |
| Octahedron | 0, 6 | 0, 6 | 0.0 s |
| Balanced tree (2, 3) | 0, 2 | 0, 2 | 0.0 s |

Bigger graphs take a few seconds:

| Graph | Looks time |
|---|---|
| 10 × 10 grid | 1.9 s |
| C60(1, 7, 13) | 1.7 s |
| Random graph with 300 vertices | 2.4 s |

Above 120 vertices there is no symmetry search and no Kamada–Kawai.

**Tried and dropped**

- **Ring turns from the stress fit alone** twisted the Petersen pentagram against the pentagon. The fix: turn variants by multiples of 180/k degrees, and a score that counts mirror images.
- **Keeping only the 6 ring variants with the lowest stress** threw away the symmetric ones, which have more stress. All variants are kept now (at most 24 per automorphism), and the automorphisms with the most edges along their rings come first.
- **A numeric gradient for the ring fit** took 19 s on a 10 × 10 grid; with the analytic gradient it takes 1.9 s.

## Force mode after Arrange for looks

**Now (decided by Roman Volochai, 2026-11-26):** the vertices glide exactly to the looks drawing, and the physics is left at rest, so nothing moves until a vertex is touched (0.0 px in headless Chrome). From the first touch force mode tidies the drawing as after the first layout (research/07), and the looks may go. On dense graphs such as the carpet this shook at first; see research/07, twelfth round. Turning force mode on, or adding a vertex or an edge, also starts tidying.

**Before: shape memory (2026-11-23 to 2026-11-26).** Tidying pulls every edge towards one common length, which undoes a circle at the first touch, and the user didn't want that at first. Of the options discussed (keep the shape; physics that keeps vertices on the circle; symmetric editing; only local moves; switching force mode off), keeping the shape was chosen. `forceShape` laid the remembered drawing over the current one every tick (shape matching after Müller et al. 2005, moved but not turned, held vertices counting 8 times more) and pulled each vertex towards its place in it. Dragging vertex 0 of the carpet 150 px moved the rest 134 px after it, and after the drop the shape came back exactly.

Why it was dropped: the user, after trying it, didn't like how the drawing moved ("don't try to keep the picture as it is, let the structure get spoiled"), and sent a screenshot of the dodecahedron squashed flat against the bottom of the canvas. The whole drawing moved after a vertex dropped near the border, and the far side ran into the border. Measured in Node, dragging one vertex of the dodecahedron (Looks) near the border and dropping it:

| Drop | Shape memory | Tidying now |
|---|---|---|
| vertex 10 at the bottom | 10 vertices against the border, 3 crossings, a vertex on an edge | none against the border, 0 crossings, vertices at least 42 px from edges |
| vertex 5 at the top | 10 against the border, 2 crossings, a vertex on an edge | none, 0 crossings, 42 px |
| vertex 0 at the right | 11 against the border, 4 crossings, a vertex on an edge | none, 0 crossings, 38 px |

Also tried while it lasted: pulling every pair of vertices towards its remembered distance (stress) followed a drag weakly; the crossing guard and the push off the border bent the drawing; turning the fit after the dragged vertex tipped the Petersen graph over.

**Open:** should the first layout itself offer looks for strongly symmetric graphs? The professor's requirement (fewest crossings first) applies until the team and the professor decide otherwise.

## Sources

- P. Eades, S.-H. Hong, "Symmetric graph drawing", in Handbook of Graph Drawing and Visualization (2013): drawing automorphisms as rotations.
- H. Purchase, "Which aesthetic has the greatest effect on human understanding?", Graph Drawing 1997: crossings matter most for understanding, which is why fewest crossings stays the default.
- T. Kamada, S. Kawai, "An algorithm for drawing general undirected graphs" (1989); E. Gansner, Y. Koren, S. North, "Graph drawing by stress majorization" (2004).
- W. T. Tutte, "How to draw a graph" (1963).
- M. Baur, U. Brandes, "Crossing reduction in circular layouts" (2004).
- Y. Koren, "Drawing graphs by eigenvectors" (2005): spectral orders.
- M. Müller, B. Heidelberger, M. Teschner, M. Gross, "Meshless deformations based on shape matching" (2005).
- F. Bertault, "A force-directed algorithm that preserves edge crossing properties" (2000), see research/07.
