# Requirements

Source: the professor, after our presentation (October 2026). Written down from memory by the team, so correct anything that is off.

## Main deliverable

A graph representation tool for Jupyter: you give it a graph, and it shows it in a simple, clean editor that you can interact with.

**Reference UI:** CS Academy graph editor, https://csacademy.com/app/graph_editor/

## Required behaviour

1. **Simple, clean graph view** in the style of CS Academy.
2. **Force mode on/off:**
   - **Frozen (force off):** you drag vertices anywhere and they stay exactly where you drop them.
   - **Unfrozen (force on):** a physics simulation runs. If you drag a vertex too close to others, they get pushed away and spring back.
3. **First layout when a graph is shown:**
   - If the graph is **planar**, draw it with **no edge crossings**.
   - If it is **not planar**, draw it with **as few crossings as possible**.

## Layout priority (decided 2026-11-05)

Following the professor's requirement for the first layout:

1. **Fewest crossings first.** Planar graphs always get 0. Non-planar graphs get as few as the search can find.
2. **Looks only after that,** and never at the cost of an extra crossing.

This also holds when a graph has several separate parts: fitting them on the canvas must not add crossings.

**Open:** should we keep crossings first, or later focus on a better view from the start? Decide this with the team and the professor. Until then the order above applies. If it changes, update this section with the date and the reason (see `AGENTS.md`).

## Force mode feel (professor, 2026-11-05)

Said at the meeting on 2026-11-05, written down by Roman Volochai. The goal is the same feel as CS Academy's force mode:

1. **Vertices resist being pushed close together.** Bringing a vertex near others takes effort; they move out of the way and keep a clear gap.
2. **Dragging a vertex across an edge is harder.** An edge resists a vertex passing through it, instead of letting it slide over as if the edge were not there.
3. In general, the physics keeps the drawing readable: no vertex resting on top of another vertex or an edge.
4. **Dragging a vertex far pulls the graph along**, as CS Academy does (added by Roman Volochai the same day, after trying both editors).
5. **Force mode keeps making the drawing tidier**, little by little, like Arrange: evenly spread, but keeping the drawing's topology (its crossings), using the canvas instead of shrinking into its middle, and keeping a tree drawn top-down in levels as the first layout draws it. After a vertex is pulled far away and dropped, the rest of the graph comes closer to it (added by Roman Volochai the same day).

Items 4 and 5 change "Force mode on/off" under Required behaviour: vertices pushed away by a drag no longer spring back to their old spots, they settle wherever the layout puts them. The first layout's crossings are kept: 0 for planar graphs.

Force mode was deliberately gentle (see [research/03](research/03-existing-editors.md)) and did neither 1 nor 2 well enough. What CS Academy does, measurements of our forces, the plan and what was done: [research/07-force-mode-feel.md](research/07-force-mode-feel.md).

## Professor's view of the current code

The existing code is a mess with many bugs and mistakes. He named the planarity checker as incorrect (confirmed, see [the assessment](research/01-current-code-assessment.md)). He said dealing with this seems like the first thing to do.

## Confirmed with the team (2026-10-23)

- **A full rewrite is acceptable** to the professor. The old version stays available under a git tag.
- **The whole team agrees to use TypeScript** for the UI, with Python for the core.
- **Scope:** only the three required behaviours above. Directed and weighted graphs are optional extras, to consider only if they turn out to be quick. Focus on the UI first.

## Labels (decided 2026-10-23)

Needed in the new version:
- **Show labels:** attribute values of vertices and edges are displayed next to vertices and on edges.
- **Edit labels:** click a vertex or edge and edit its attributes in a side panel.
- **Colors:** a vertex `color` attribute colors the vertex.
- **Show/hide toggle** for labels.

API: only `edit(graph)` is required. Compatibility with the old `edit(graph, color_dict)` is not needed.

## Deadline

2027-01-21, the last day of the course. A working solution must be ready by then. Meeting dates are in [schedule](schedule.md).
