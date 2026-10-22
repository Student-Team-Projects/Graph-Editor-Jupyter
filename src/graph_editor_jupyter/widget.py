from pathlib import Path

import anywidget
import networkx as nx
import traitlets

from .layout import initial_layout

_STATIC = Path(__file__).parent / "static"
PADDING = 20  # must match PADDING in js/src/widget.ts


class GraphWidget(anywidget.AnyWidget):
    """Jupyter widget showing a NetworkX graph. The front end is in js/src/widget.ts."""

    _esm = _STATIC / "widget.js"
    _css = _STATIC / "widget.css"

    # Vertices are sent by index; `nodes` holds their display labels.
    nodes = traitlets.List(traitlets.Unicode()).tag(sync=True)
    edges = traitlets.List(traitlets.List(traitlets.Int())).tag(sync=True)
    positions = traitlets.List(traitlets.List(traitlets.Float())).tag(sync=True)
    width = traitlets.Int(800).tag(sync=True)
    height = traitlets.Int(500).tag(sync=True)

    def __init__(self, graph: nx.Graph, **kwargs):
        super().__init__(**kwargs)
        self.graph = graph
        self._order = list(graph.nodes)
        index = {node: i for i, node in enumerate(self._order)}
        pos = initial_layout(graph, size=(self.width - 2 * PADDING, self.height - 2 * PADDING))

        self.nodes = [str(node) for node in self._order]
        self.edges = [[index[u], index[v]] for u, v in graph.edges]
        self.positions = [list(pos[node]) for node in self._order]
