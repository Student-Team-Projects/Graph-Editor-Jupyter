from dataclasses import dataclass
from pathlib import Path

import anywidget
import networkx as nx
import traitlets

from .layout import initial_layout

_STATIC = Path(__file__).parent / "static"
PADDING = 20  # must match PADDING in js/src/widget.ts
HISTORY_LIMIT = 100  # edits kept for undo


@dataclass
class _Snapshot:
    """Everything an undo restores: the graph with its attributes, the ids and positions."""

    nodes: list  # [(node, attrs)]
    edges: list  # [(u, v, attrs)]
    node_of: dict
    positions: dict


class GraphWidget(anywidget.AnyWidget):
    """Jupyter widget editing a NetworkX graph in place. The front end is in js/src/widget.ts.

    Vertices get stable integer ids for the front end, because NetworkX nodes can be any
    hashable object. Positions are normalized to [0, 1] and owned by the front end once shown.

    The editor's Arrange button redraws the current graph with the first-layout algorithm
    (arrange() does the same from Python). Edits from the editor can be undone (undo/redo, also Ctrl+Z/Ctrl+Y in the editor). Undo
    restores the graph as the editor left it, so it also reverts changes made to the graph in
    Python since that edit.
    """

    _esm = _STATIC / "widget.js"
    _css = _STATIC / "widget.css"

    nodes = traitlets.List(traitlets.Dict()).tag(sync=True)  # [{"id": int, "label": str}]
    edges = traitlets.List(traitlets.List(traitlets.Int())).tag(sync=True)  # [[id, id]]
    positions = traitlets.Dict().tag(sync=True)  # {str(id): [x, y]}
    width = traitlets.Int(800).tag(sync=True)
    height = traitlets.Int(500).tag(sync=True)
    can_undo = traitlets.Bool(False).tag(sync=True)
    can_redo = traitlets.Bool(False).tag(sync=True)

    def __init__(self, graph: nx.Graph, **kwargs):
        if graph.is_directed() or graph.is_multigraph():
            raise TypeError(
                "edit() supports undirected simple graphs (nx.Graph) for now; "
                f"got {type(graph).__name__}. Try nx.Graph(graph) to convert."
            )
        super().__init__(**kwargs)
        self.graph = graph
        self._node_of: dict[int, object] = {}
        self._id_of: dict[object, int] = {}
        self._next_id = 0
        self._undo: list[_Snapshot] = []
        self._redo: list[_Snapshot] = []
        for node in graph.nodes:
            self._register(node)

        self.positions = self._best_layout()
        self._sync_structure()
        self.on_msg(self._on_msg)

    def _best_layout(self) -> dict:
        """Positions from the first-layout algorithm: no crossings if planar, few otherwise."""
        pos = initial_layout(self.graph, size=(self.width - 2 * PADDING, self.height - 2 * PADDING))
        return {str(self._id_of[node]): list(p) for node, p in pos.items()}

    def _register(self, node) -> int:
        node_id = self._next_id
        self._next_id += 1
        self._node_of[node_id] = node
        self._id_of[node] = node_id
        return node_id

    def _sync_structure(self) -> None:
        self.nodes = [{"id": self._id_of[n], "label": str(n)} for n in self.graph.nodes]
        self.edges = [[self._id_of[u], self._id_of[v]] for u, v in self.graph.edges]

    def _sync_from_graph(self) -> None:
        """Catch up with changes made to the graph in Python after the widget was shown."""
        for node_id, node in list(self._node_of.items()):
            if node not in self.graph:
                del self._node_of[node_id]
                del self._id_of[node]
        missing = [n for n in self.graph.nodes if n not in self._id_of]
        if missing:
            positions = dict(self.positions)
            for k, node in enumerate(missing):
                # No layout for them yet: put them in a row along the top edge.
                positions[str(self._register(node))] = [(k + 1) / (len(missing) + 1), 0.0]
            self.positions = positions

    def _node(self, node_id):
        """The NetworkX node for a front-end id, or None if it no longer exists."""
        node = self._node_of.get(node_id)
        return node if node is not None and node in self.graph else None

    def _new_node(self):
        """Smallest non-negative integer that is not a node yet."""
        n = 0
        while n in self.graph:
            n += 1
        return n

    # ---- undo ----

    def _snapshot(self, positions=None) -> _Snapshot:
        self._sync_from_graph()
        return _Snapshot(
            nodes=[(n, dict(d)) for n, d in self.graph.nodes(data=True)],
            edges=[(u, v, dict(d)) for u, v, d in self.graph.edges(data=True)],
            node_of=dict(self._node_of),
            positions=dict(self.positions if positions is None else positions),
        )

    def _restore(self, snap: _Snapshot) -> None:
        # Changed in place, because the user holds a reference to this graph.
        self.graph.remove_nodes_from(list(self.graph.nodes))
        self.graph.add_nodes_from(snap.nodes)
        self.graph.add_edges_from(snap.edges)
        self._node_of = dict(snap.node_of)
        self._id_of = {node: node_id for node_id, node in self._node_of.items()}
        self.positions = dict(snap.positions)
        self._sync_structure()
        # The front end keeps its own positions for vertices it already shows; tell it to move.
        self.send({"type": "set_positions", "positions": self.positions})

    def _step(self, source: list, target: list, positions=None) -> None:
        # Python undo/redo bypass _on_msg, so catch up with external graph edits too.
        self._sync_from_graph()
        if not source:
            return
        target.append(self._snapshot(positions))
        self._restore(source.pop())
        self._update_history_flags()

    def _update_history_flags(self) -> None:
        self.can_undo = bool(self._undo)
        self.can_redo = bool(self._redo)

    def arrange(self) -> None:
        """Redraw the graph like the first layout: no crossings if planar, few otherwise."""
        self._on_msg(self, {"type": "arrange"}, [])

    def undo(self) -> None:
        """Revert the last edit made in the editor."""
        self._step(self._undo, self._redo)

    def redo(self) -> None:
        """Repeat the last undone edit."""
        self._step(self._redo, self._undo)

    # ---- messages from the front end ----

    def _on_msg(self, _widget, content: dict, _buffers) -> None:
        # Messages can be stale (a click racing a delete, or the graph changed in Python
        # meanwhile), so unknown vertices are ignored instead of raising.
        self._sync_from_graph()
        # Edits carry the front end's current positions; Python's copy can lag behind in
        # force mode, and undo must restore what was on screen.
        positions = content.get("positions")
        if not isinstance(positions, dict):
            positions = None
        kind = content.get("type")
        if kind == "undo":
            self._step(self._undo, self._redo, positions)
            return
        if kind == "redo":
            self._step(self._redo, self._undo, positions)
            return
        before = self._snapshot(positions)
        if positions is not None:
            known = {str(node_id) for node_id in self._node_of}
            self.positions = {k: p for k, p in positions.items() if k in known}
        try:
            if self._apply(kind, content):
                self._undo = (self._undo + [before])[-HISTORY_LIMIT:]
                self._redo = []
                self._update_history_flags()
            self._sync_structure()
        finally:
            if kind == "arrange":
                # Also ends the "Arranging..." state in the front end, even if layout failed.
                self.send({"type": "set_positions", "positions": self.positions, "settle": True})

    def _apply(self, kind, content: dict) -> bool:
        """Applies one edit; returns whether anything changed."""
        if kind == "add_node":
            node = self._new_node()
            self.graph.add_node(node)
            node_id = self._register(node)
            self.positions = {**self.positions, str(node_id): [content["x"], content["y"]]}
            return True
        if kind == "add_edge":
            u, v = self._node(content.get("u")), self._node(content.get("v"))
            if u is None or v is None or u == v or self.graph.has_edge(u, v):
                return False
            self.graph.add_edge(u, v)
            return True
        if kind == "remove_node":
            node = self._node(content.get("id"))
            if node is None:
                return False
            self.graph.remove_node(node)
            self._sync_from_graph()
            self.positions = {k: p for k, p in self.positions.items() if k != str(content["id"])}
            return True
        if kind == "remove_edge":
            u, v = self._node(content.get("u")), self._node(content.get("v"))
            if u is None or v is None or not self.graph.has_edge(u, v):
                return False
            self.graph.remove_edge(u, v)
            return True
        if kind == "arrange":
            # Same algorithm as the first layout, on the graph as it is now.
            new = self._best_layout()
            changed = new != self.positions
            self.positions = new
            return changed
        # The front end sends this when a drag starts; the new positions follow in `positions`.
        return kind == "move"
