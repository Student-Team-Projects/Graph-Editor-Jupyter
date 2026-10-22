## Interactive Graph Editor for Jupyter

`edit(graph)` shows a NetworkX graph in an interactive editor inside a Jupyter notebook.

> **Rewrite in progress.** This branch contains a new version built with [anywidget](https://anywidget.dev) (Python + TypeScript). The previous version is on `main` and under the git tag `legacy-v0.0.6`.

### Example

```python
import networkx as nx
from graph_editor_jupyter import edit

edit(nx.dodecahedral_graph())
```

Planar graphs are drawn without edge crossings; other graphs with as few crossings as the search can find (it reaches the known minimum for K5, K3,3, the Petersen graph and other classic examples).

- **Click empty space**: add a vertex. **Click two vertices**: add an edge.
- **Drag** a vertex to move it. **Double-click** (or select and press Delete) to remove.
- **Force: off / on**: freeze the layout, or let physics push vertices apart (and off edges).
- **− / + / Fit**: zoom. Drag empty space to pan.

Every edit changes the NetworkX graph you passed in.

### Development

See [docs/development.md](docs/development.md). Project requirements and decisions are in [docs/](docs/README.md).
