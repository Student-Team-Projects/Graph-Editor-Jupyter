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
