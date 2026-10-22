import networkx as nx
import pytest

from graph_editor_jupyter import GraphWidget
from graph_editor_jupyter.widget import _STATIC


def ids(widget: GraphWidget) -> dict:
    """Map from NetworkX node to the id the front end uses."""
    return {n["label"]: n["id"] for n in widget.nodes}


def send(widget: GraphWidget, **content):
    widget._on_msg(widget, content, [])


def test_widget_sends_graph_by_id():
    widget = GraphWidget(nx.Graph([("a", "b"), ("b", "c")]))
    i = ids(widget)
    assert set(i) == {"a", "b", "c"}
    assert sorted(map(sorted, widget.edges)) == sorted([sorted([i["a"], i["b"]]), sorted([i["b"], i["c"]])])
    assert set(widget.positions) == {str(v) for v in i.values()}


def test_widget_keeps_the_original_graph():
    graph = nx.path_graph(3)
    assert GraphWidget(graph).graph is graph


def test_add_node_uses_smallest_free_integer():
    graph = nx.Graph([(0, 1), (1, 3)])
    widget = GraphWidget(graph)
    send(widget, type="add_node", x=0.2, y=0.3)
    assert 2 in graph
    new_id = ids(widget)["2"]
    assert widget.positions[str(new_id)] == [0.2, 0.3]


def test_add_and_remove_edge_change_the_graph():
    graph = nx.empty_graph(3)
    widget = GraphWidget(graph)
    i = ids(widget)
    send(widget, type="add_edge", u=i["0"], v=i["2"])
    assert graph.has_edge(0, 2)
    assert [i["0"], i["2"]] in widget.edges
    send(widget, type="remove_edge", u=i["2"], v=i["0"])
    assert not graph.has_edge(0, 2)
    assert widget.edges == []


def test_self_loop_is_ignored():
    graph = nx.empty_graph(1)
    widget = GraphWidget(graph)
    send(widget, type="add_edge", u=ids(widget)["0"], v=ids(widget)["0"])
    assert graph.number_of_edges() == 0


def test_remove_node_removes_its_edges_and_position():
    graph = nx.path_graph(3)
    widget = GraphWidget(graph)
    middle = ids(widget)["1"]
    send(widget, type="remove_node", id=middle)
    assert list(graph.nodes) == [0, 2]
    assert graph.number_of_edges() == 0
    assert str(middle) not in widget.positions
    assert widget.edges == []


def test_ids_stay_stable_after_removal():
    graph = nx.path_graph(3)
    widget = GraphWidget(graph)
    before = ids(widget)
    send(widget, type="remove_node", id=before["0"])
    after = ids(widget)
    assert after["1"] == before["1"] and after["2"] == before["2"]


def test_works_with_non_integer_nodes():
    graph = nx.Graph([("x", "y")])
    widget = GraphWidget(graph)
    send(widget, type="add_node", x=0.5, y=0.5)
    assert set(graph.nodes) == {"x", "y", 0}


def test_unknown_message_is_ignored():
    graph = nx.path_graph(2)
    widget = GraphWidget(graph)
    send(widget, type="something_else")
    assert list(graph.edges) == [(0, 1)]


def test_repeated_or_stale_messages_are_ignored():
    graph = nx.path_graph(3)
    widget = GraphWidget(graph)
    i = ids(widget)
    send(widget, type="remove_node", id=i["0"])
    send(widget, type="remove_node", id=i["0"])
    send(widget, type="add_edge", u=i["0"], v=i["2"])
    send(widget, type="remove_edge", u=i["0"], v=i["1"])
    assert set(graph.nodes) == {1, 2}
    assert list(graph.edges) == [(1, 2)]


def test_python_side_changes_are_picked_up():
    graph = nx.path_graph(3)
    widget = GraphWidget(graph)
    i = ids(widget)
    graph.remove_node(2)
    graph.add_node("new")
    send(widget, type="add_edge", u=i["2"], v=i["0"])  # vertex 2 is gone: ignored
    assert 2 not in graph
    assert "new" in ids(widget)
    assert "2" not in ids(widget)
    assert str(ids(widget)["new"]) in widget.positions


@pytest.mark.parametrize("graph", [nx.DiGraph([(0, 1)]), nx.MultiGraph([(0, 1), (0, 1)])])
def test_unsupported_graph_types_get_a_clear_error(graph):
    with pytest.raises(TypeError, match="undirected simple graphs"):
        GraphWidget(graph)


def test_self_loops_are_sent():
    widget = GraphWidget(nx.Graph([(0, 0), (0, 1)]))
    i = ids(widget)
    assert [i["0"], i["0"]] in widget.edges


def test_front_end_bundle_exists():
    # Fails if `npm run build` in js/ was not run.
    assert (_STATIC / "widget.js").exists() and (_STATIC / "widget.css").exists()
