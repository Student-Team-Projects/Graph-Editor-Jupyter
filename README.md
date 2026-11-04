## Interactive Graph Editor for Jupyter

`edit(graph)` shows a NetworkX graph in an interactive editor inside a Jupyter notebook.

> **Rewrite in progress.** This branch contains a new version built with [anywidget](https://anywidget.dev) (Python + TypeScript). The previous version is on `main` and under the git tag `legacy-v0.0.6`.

### Try it

You need only [Python 3.10+](https://www.python.org/downloads/) (and git to clone). No Node.js.

```
git clone -b develop https://github.com/Student-Team-Projects/Graph-Editor-Jupyter.git
cd Graph-Editor-Jupyter
python run.py
```

Use `python3` if `python` isn't found. The first run needs internet and takes a few minutes: it creates `.venv` and installs everything into it. Then JupyterLab opens the demo notebook `main.ipynb` in your browser; choose **Run > Run All Cells**.

To use it in your own notebook, install it into your environment:

```
pip install git+https://github.com/Student-Team-Projects/Graph-Editor-Jupyter.git@develop
```

### Example

```python
import networkx as nx
from graph_editor_jupyter import edit

edit(nx.dodecahedral_graph())
```

Planar graphs are drawn without edge crossings; other graphs with as few crossings as the search can find (it reaches the known minimum for K5, K3,3, the Petersen graph and other classic examples).

- **Click empty space**: add a vertex. **Click two vertices**: add an edge.
- **Drag** a vertex to move it. **Select and press Delete** to remove. **Esc** cancels a selection.
- **Force: on / off**: let physics push vertices apart (and off edges), or freeze the layout.
- **Arrange**: draw the current graph again with as few crossings as possible.
- **Undo / Redo** (Ctrl+Z, Ctrl+Y): take back any edit, move or Arrange.
- **− / + / Fit** (or Ctrl+wheel): zoom. Drag empty space to pan.

Every edit changes the NetworkX graph you passed in, so later cells see it. Graphs must be plain `nx.Graph`; directed graphs and multigraphs aren't supported yet.

### Development

See [docs/development.md](docs/development.md). Project requirements and decisions are in [docs/](docs/README.md).
