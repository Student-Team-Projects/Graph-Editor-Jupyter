import networkx as nx

from graph_editor_jupyter import GraphWidget
from graph_editor_jupyter.widget import _STATIC


def test_widget_sends_graph_by_index():
    graph = nx.Graph([("a", "b"), ("b", "c")])
    widget = GraphWidget(graph)
    assert widget.nodes == ["a", "b", "c"]
    assert widget.edges == [[0, 1], [1, 2]]
    assert len(widget.positions) == 3


def test_widget_keeps_the_original_graph():
    graph = nx.path_graph(3)
    assert GraphWidget(graph).graph is graph


def test_front_end_bundle_exists():
    # Fails if `npm run build` in js/ was not run.
    assert (_STATIC / "widget.js").exists() and (_STATIC / "widget.css").exists()
