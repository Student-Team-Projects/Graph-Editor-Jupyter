from pathlib import Path

import anywidget
import networkx as nx
import traitlets

from .layout import initial_layout

_STATIC = Path(__file__).parent / "static"
PADDING = 20  # must match PADDING in js/src/widget.ts


class GraphWidget(anywidget.AnyWidget):
    """Jupyter widget editing a NetworkX graph in place. The front end is in js/src/widget.ts.

    Vertices get stable integer ids for the front end, because NetworkX nodes can be any
    hashable object. Positions are normalized to [0, 1] and owned by the front end once shown.
    """

    _esm = _STATIC / "widget.js"
    _css = _STATIC / "widget.css"

    nodes = traitlets.List(traitlets.Dict()).tag(sync=True)  # [{"id": int, "label": str}]
    edges = traitlets.List(traitlets.List(traitlets.Int())).tag(sync=True)  # [[id, id]]
    positions = traitlets.Dict().tag(sync=True)  # {str(id): [x, y]}
    width = traitlets.Int(800).tag(sync=True)
    height = traitlets.Int(500).tag(sync=True)

    def __init__(self, graph: nx.Graph, **kwargs):
        super().__init__(**kwargs)
        self.graph = graph
        self._node_of: dict[int, object] = {}
        self._id_of: dict[object, int] = {}
        self._next_id = 0
        for node in graph.nodes:
            self._register(node)

        pos = initial_layout(graph, size=(self.width - 2 * PADDING, self.height - 2 * PADDING))
        self.positions = {str(self._id_of[node]): list(p) for node, p in pos.items()}
        self._sync_structure()
        self.on_msg(self._on_msg)

    def _register(self, node) -> int:
        node_id = self._next_id
        self._next_id += 1
        self._node_of[node_id] = node
        self._id_of[node] = node_id
        return node_id

    def _sync_structure(self) -> None:
        self.nodes = [{"id": self._id_of[n], "label": str(n)} for n in self.graph.nodes]
        self.edges = [[self._id_of[u], self._id_of[v]] for u, v in self.graph.edges]

    def _new_node(self):
        """Smallest non-negative integer that is not a node yet."""
        n = 0
        while n in self.graph:
            n += 1
        return n

    def _on_msg(self, _widget, content: dict, _buffers) -> None:
        kind = content.get("type")
        if kind == "add_node":
            node = self._new_node()
            self.graph.add_node(node)
            node_id = self._register(node)
            self.positions = {**self.positions, str(node_id): [content["x"], content["y"]]}
        elif kind == "add_edge":
            u, v = self._node_of[content["u"]], self._node_of[content["v"]]
            if u != v:
                self.graph.add_edge(u, v)
        elif kind == "remove_node":
            node = self._node_of.pop(content["id"])
            del self._id_of[node]
            self.graph.remove_node(node)
            self.positions = {k: p for k, p in self.positions.items() if k != str(content["id"])}
        elif kind == "remove_edge":
            u, v = self._node_of[content["u"]], self._node_of[content["v"]]
            if self.graph.has_edge(u, v):
                self.graph.remove_edge(u, v)
        else:
            return
        self._sync_structure()
