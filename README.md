## Interactive Graph Editor for Jupyter

`edit(graph)` shows a NetworkX graph in an interactive editor inside a Jupyter notebook.

> **Rewrite in progress.** This branch contains a new version built with [anywidget](https://anywidget.dev) (Python + TypeScript). The previous version is on `main` and under the git tag `legacy-v0.0.6`.

### Example

```python
import networkx as nx
from graph_editor_jupyter import edit

edit(nx.dodecahedral_graph())
```

Planar graphs are drawn without edge crossings.

### Development

See [docs/development.md](docs/development.md). Project requirements and decisions are in [docs/](docs/README.md).
