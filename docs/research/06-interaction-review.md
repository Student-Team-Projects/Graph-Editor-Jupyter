# Interaction review: are our gestures good UI?

Date: 2026-10-23. Purpose: [research/03](03-existing-editors.md) copied what other editors *do*. This review checks what usability guidelines, user complaints and research *say* about those choices, and fixes what doesn't hold up.

## Our gestures checked against outside opinion

| Gesture (before this review) | What we found | Verdict |
|---|---|---|
| Click two vertices → edge | yEd starts an edge when you drag from a node. Its users complain that they can't tell whether a drag will move the node or start an edge; a request to change this has been open since 2013. Our click-click keeps "drag" meaning only "move". | Keep. Add a preview line so it's visible that an edge is being drawn. |
| Drag → move | Standard in every editor looked at. | Keep |
| Click empty space → add vertex | Same as CS Academy and other teaching editors. Our code already prevents the classic accident: with something selected, a click on empty space only deselects. | Keep |
| Double-click → remove | Usability studies (KDE, Baymard) observed many users double-clicking out of habit where one click is enough, so destructive actions on double-click fire by accident. With no undo, the loss was permanent. It also combined badly with click-click: with vertex A selected, double-clicking B first added edge A–B, then deleted B. Editors usually use double-click to *edit* (wild-inter.net's editor opens an edge's weight), which is what we need for labels. | Change |
| Zoom with buttons only; the mouse wheel scrolls the notebook | Plotly and bqplot users complain about widgets that zoom when you try to scroll the notebook. Google Maps solves the same problem with "cooperative" handling: plain scrolling scrolls the page, and you hold a modifier to zoom. | Keep. Add Ctrl + wheel to zoom. |
| Gentle force mode (layout stays stable) | Research on preserving the "mental map" is mixed. Stability helps in many studies, not all, and the best amount depends on the task. Letting the user control stability is an active research direction. Our force/freeze toggle is that control. | Keep |

## What was missing

- **Undo.** Nielsen's heuristic "User control and freedom" asks for undo and redo as the emergency exit from mistakes. A paper on graph-editing interactions (Gladisch et al.) lists recoverability as a quality criterion. We had no undo at all.
- **Status feedback.** Nielsen's "Visibility of system status": the user should see what the system is doing and what to do next. Our help line was static. While a vertex is selected, nothing told the user that the next click on a vertex draws an edge.

## Decided (2026-10-23)

1. **Double-click no longer removes anything.** Delete or Backspace removes the selection. Double-click is kept free for label editing.
2. **Undo and redo**: Ctrl+Z, and Ctrl+Y or Ctrl+Shift+Z (Cmd on macOS), plus Undo and Redo buttons in the toolbar. Every edit can be undone: adding or removing a vertex or edge, and moving vertices. Undo lives in Python, which owns the NetworkX graph, so a removed vertex comes back with its attributes and edges. The history holds the last 100 edits, and a new edit clears redo.
3. **Preview line and hint while drawing an edge.** With a vertex selected, a dashed line follows the pointer (and snaps to the vertex under it), and the help line changes to say what the next click does.
4. **Ctrl + wheel zooms** around the pointer (touchpad pinch sends the same event). A plain wheel still scrolls the notebook.

## Sources

- yEd Q&A: [How can I move a node instead of starting an edge?](https://yed.yworks.com/support/qa/25065/how-can-i-move-a-node-instead-of-starting-an-edge), [Move nodes without first needing to select them](https://yed.yworks.com/support/qa/9222/move-nodes-without-first-needing-to-select-them), [edit mode manual](https://yed.yworks.com/support/manual/edit_mode.html)
- Nielsen Norman Group: [10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [Coding Horror: Double-Click Must Die](https://blog.codinghorror.com/double-click-must-die/) (quotes Nielsen and a KDE usability study); [Baymard: users double-click online](https://baymard.com/blog/users-double-click-online)
- Gladisch et al., [Mapping Tasks to Interactions for Graph Exploration and Graph Editing on Interactive Surfaces](https://arxiv.org/abs/1504.07844) (2015)
- [Graph Editor at wild-inter.net](https://www.wild-inter.net/teaching/ads/graph-editor) (teaching tool: click to add, Shift-drag for edges, double-click edits weight)
- [cytoscape.js-edgehandles](https://github.com/ckapop/cytoscape.js-edgehandles) (edge preview while drawing)
- Wheel zoom in notebooks: [Plotly forum](https://community.plotly.com/t/scrollzoom-with-modifier-key/8156), [bqplot issue](https://lightrun.com/answers/bqplot-bqplot-notebook-scrolls-when-zooming); [Google Maps cooperative gesture handling](https://developers.google.com/maps/documentation/javascript/examples/interaction-cooperative)
- Mental map: Federico & Miksch, [Evaluation of two interaction techniques for visualization of dynamic graphs](https://arxiv.org/abs/1608.08936) (GD 2016); Purchase & Samra, [Extremes are better](https://research.monash.edu/en/publications/extremes-are-better-investigating-mental-map-preservation-in-dyna/)
- Not found: a controlled study comparing drag versus click-click for creating edges, and any published critique of CS Academy's editor.
