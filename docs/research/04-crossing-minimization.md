# Crossing minimization for non-planar graphs

Date: 2026-10-23. Requirement: non-planar graphs are drawn with as few crossings as possible (see [requirements](../requirements.md)).

## The problem

Finding the minimum number of crossings of a straight-line drawing (the rectilinear crossing number) is NP-hard, so practical tools use heuristics. A second difficulty showed up in testing: a drawing with the minimum number of crossings can still look bad. Uneven edge lengths, edges nearly on top of each other, and vertices pressed against edges all count as "optimal" if only crossings are measured.

## Existing approaches

| Approach | What it does | Usable for us? |
|---|---|---|
| Davidson & Harel, "Drawing graphs nicely using simulated annealing" (1996) | One energy combining even vertex spacing, uniform edge lengths, crossings, and vertex-edge distance | The idea, yes. Implemented in igraph, but igraph is GPL-licensed (our project is MIT) |
| Stress-Plus-X (SPX), Devkota, Ahmed, De Luca, Isaacs, Kobourov (GD 2019) | Stress (the standard "nice drawing" measure) plus a crossing penalty, optimized together | The idea, yes. Their code needs the commercial CPLEX solver and takes minutes per graph |
| Radermacher, Reichard, Rutter, Wagner, geometric heuristics (ALENEX 2018) | Vertex movement (move one vertex to its best spot) and edge insertion | Best crossing counts in SPX's benchmark. Our search uses vertex movement |
| Planarization (OGDF) | Large planar subgraph drawn without crossings, then the remaining edges inserted | The idea, yes, as a starting candidate. OGDF itself: 91 MB package, no macOS build, and its planarization layout bends edges |
| Plain force-directed / stress layouts | Nice shapes | Stress does not reliably minimize crossings (shown experimentally, see the SPX paper) |

## What we built (`_CrossingSearch` in `layout.py`)

A combination of the ideas above, using only NumPy, SciPy and NetworkX:

1. **Starting candidates:** ordinary layouts (Kamada-Kawai, spring layouts with several seeds) plus a planarization candidate (large planar subgraph drawn crossing-free, remaining edges added).
2. **Phase 1, fewest crossings** (Radermacher-style vertex movement, iterated): from the 3 best candidates, move one vertex at a time to the spot with the lowest *badness*. When no single move helps, shake 4 random vertices and search again, keeping only improvements.
   - *Badness* = crossings + 10 × near-misses. A near-miss is an edge passing through or grazing a vertex, or two vertices on top of each other. It must cost far more than a crossing: an edge through a vertex is ambiguous and can hide several crossings (K7 found exactly this loophole when it cost 2).
3. **Phase 2, looks** (SPX and Davidson-Harel ideas): lower an *energy* while never letting badness grow. Energy = stress (vertex pairs as far apart as their graph distance) + a vertex-edge term that grows as a vertex gets closer than 40 px to an edge it isn't part of. Stress alone pressed vertices against edges once crossings were fixed.
4. Fixed random seed, so the result is the same every run. Time budget about 2.4 s per component.

## Results (tests in `tests/test_layout.py`)

Known minimum crossings, reached for seeds 0, 1 and 2, with no near-misses:

| Graph | Minimum | Ours |
|---|---|---|
| K5 | 1 | 1 |
| K6 | 3 | 3 |
| K7 | 9 | 9 |
| K3,3 | 1 | 1 |
| K3,4 | 2 | 2 |
| K4,4 | 4 | 4 |
| Petersen | 2 | 2 |
| Heawood | 3 | 3 |

Random 3-regular graph with 40 vertices: 13 crossings, against 21 for the best of 8 plain spring layouts.

**Known weakness:** dense graphs such as K6 and K7 reach the minimum crossings but can look lopsided. Their optimal drawings are nested shapes, which stress does not favour.

## Mistakes found during development (each has a regression test)

- Counting only proper crossings let an edge pass through a vertex for free ("K5 with 0 crossings").
- The per-vertex score left out some terms of the full score, so the search went in circles. Tests now compare the quick per-vertex scores with the full scores for random moves, for both phases.
- Optimizing crossings and looks in one step wasted the time budget and lost optima. They are now two phases.

## Sources

- Davidson & Harel (1996): https://dl.acm.org/doi/10.1145/234535.234538
- igraph Davidson-Harel layout: https://r.igraph.org/reference/layout_with_dh.html
- SPX paper: https://arxiv.org/abs/1908.01769 and code: https://github.com/devkotasabin/SPX-graph-layout
- Graph drawing metrics survey (2024): https://www2.cs.arizona.edu/~kobourov/gd-metrics2024.pdf
- OGDF Python bindings: https://pypi.org/project/ogdf-python and https://pypi.org/project/ogdf-wheel/
- Graph Drawing Contest live challenges: https://mozart.diei.unipg.it/gdcontest/contest2017/challenge.html
