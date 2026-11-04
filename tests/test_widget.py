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


# ---- undo / redo ----


def test_undo_and_redo_add_node():
    graph = nx.path_graph(2)
    widget = GraphWidget(graph)
    send(widget, type="add_node", x=0.5, y=0.5)
    assert 2 in graph and widget.can_undo
    send(widget, type="undo")
    assert set(graph) == {0, 1} and not widget.can_undo and widget.can_redo
    send(widget, type="redo")
    assert 2 in graph and widget.can_undo and not widget.can_redo


def test_undo_remove_node_restores_edges_attributes_and_id():
    graph = nx.Graph()
    graph.add_node("a", color="red")
    graph.add_edge("a", "b", weight=3)
    widget = GraphWidget(graph)
    i = ids(widget)
    position = widget.positions[str(i["a"])]
    send(widget, type="remove_node", id=i["a"])
    send(widget, type="undo")
    assert graph.nodes["a"] == {"color": "red"}
    assert graph.edges["a", "b"] == {"weight": 3}
    assert ids(widget) == i
    assert widget.positions[str(i["a"])] == position


def test_undo_keeps_the_same_graph_object_and_its_attributes():
    graph = nx.path_graph(3)
    graph.graph["name"] = "path"
    widget = GraphWidget(graph)
    send(widget, type="remove_edge", u=0, v=1)
    send(widget, type="undo")
    assert widget.graph is graph
    assert graph.has_edge(0, 1) and graph.graph == {"name": "path"}


def test_undo_move_restores_positions_sent_with_the_message():
    widget = GraphWidget(nx.path_graph(2))
    before = {"0": [0.1, 0.1], "1": [0.9, 0.9]}
    send(widget, type="move", positions=before)
    widget.positions = {"0": [0.5, 0.5], "1": [0.9, 0.9]}  # the drag result, as the front end syncs it
    sent = []
    widget.send = sent.append
    send(widget, type="undo", positions=dict(widget.positions))
    assert widget.positions == before
    assert sent == [{"type": "set_positions", "positions": before}]
    send(widget, type="redo")
    assert widget.positions == {"0": [0.5, 0.5], "1": [0.9, 0.9]}


def test_new_edit_clears_redo():
    graph = nx.empty_graph(2)
    widget = GraphWidget(graph)
    send(widget, type="add_edge", u=0, v=1)
    send(widget, type="undo")
    send(widget, type="add_node", x=0, y=0)
    assert not widget.can_redo
    send(widget, type="redo")
    assert not graph.has_edge(0, 1)


def test_edits_that_change_nothing_are_not_recorded():
    widget = GraphWidget(nx.path_graph(2))
    send(widget, type="add_edge", u=0, v=1)  # already there
    send(widget, type="add_edge", u=0, v=0)  # self-loop
    send(widget, type="remove_edge", u=0, v=99)
    send(widget, type="remove_node", id=99)
    send(widget, type="nonsense")
    assert not widget.can_undo


def test_undo_with_empty_history_does_nothing():
    graph = nx.path_graph(2)
    widget = GraphWidget(graph)
    widget.undo()
    widget.redo()
    assert set(graph.edges) == {(0, 1)}


def test_history_is_limited():
    from graph_editor_jupyter.widget import HISTORY_LIMIT

    graph = nx.empty_graph(0)
    widget = GraphWidget(graph)
    for _ in range(HISTORY_LIMIT + 5):
        send(widget, type="add_node", x=0, y=0)
    while widget.can_undo:
        widget.undo()
    assert len(graph) == 5


def test_undo_from_python():
    graph = nx.path_graph(2)
    widget = GraphWidget(graph)
    send(widget, type="remove_edge", u=0, v=1)
    widget.undo()
    assert graph.has_edge(0, 1)


@pytest.mark.parametrize("first_step", ["undo", "redo"])
def test_python_history_syncs_external_nodes(first_step):
    graph = nx.path_graph(2)
    widget = GraphWidget(graph)
    send(widget, type="remove_edge", u=0, v=1)
    if first_step == "redo":
        widget.undo()
    graph.add_node("external", color="red")
    graph.add_edge(0, "external", weight="label")
    other_step = "redo" if first_step == "undo" else "undo"

    getattr(widget, first_step)()
    assert "external" not in graph
    getattr(widget, other_step)()

    assert widget.graph is graph
    assert graph.nodes["external"] == {"color": "red"}
    assert graph.edges[0, "external"] == {"weight": "label"}
    node_id = ids(widget)["external"]
    assert widget._node_of[node_id] == "external"
    assert str(node_id) in widget.positions
    assert [ids(widget)["0"], node_id] in widget.edges
    getattr(widget, first_step)()
    getattr(widget, other_step)()
    assert ids(widget)["external"] == node_id


def test_snapshot_syncs_external_graph_changes():
    graph = nx.path_graph(2)
    widget = GraphWidget(graph)
    graph.remove_node(1)
    graph.add_node("external")
    snapshot = widget._snapshot()
    assert set(snapshot.node_of.values()) == set(graph)
    assert str(widget._id_of["external"]) in snapshot.positions
    widget._restore(snapshot)
    assert set(ids(widget)) == {"0", "external"}


def test_malformed_positions_are_ignored():
    widget = GraphWidget(nx.path_graph(2))
    send(widget, type="add_node", x=0, y=0, positions={"junk": [0, 0], "0": [0.3, 0.3]})
    assert "junk" not in widget.positions
    assert widget.positions["0"] == [0.3, 0.3]


# ---- arrange ----


def test_arrange_redraws_a_tangled_planar_graph_without_crossings():
    from graph_editor_jupyter.layout import count_crossings

    graph = nx.cycle_graph(6)
    widget = GraphWidget(graph)
    tangled = {"0": [0, 0], "1": [1, 1], "2": [0, 1], "3": [1, 0], "4": [0.5, 0], "5": [0.5, 1]}
    sent = []
    widget.send = sent.append
    send(widget, type="arrange", positions=tangled)
    by_node = {widget._node_of[int(k)]: p for k, p in widget.positions.items()}
    assert count_crossings(graph, by_node) == 0
    assert sent == [{"type": "set_positions", "positions": widget.positions, "settle": True}]


def test_arrange_can_be_undone():
    widget = GraphWidget(nx.cycle_graph(4))
    tangled = {"0": [0, 0], "1": [1, 1], "2": [0, 1], "3": [1, 0]}
    send(widget, type="arrange", positions=tangled)
    send(widget, type="undo")
    assert widget.positions == tangled


def test_arrange_when_already_arranged_adds_no_undo_step():
    widget = GraphWidget(nx.path_graph(4))
    widget.arrange()
    assert not widget.can_undo


def test_arrange_includes_vertices_added_in_the_editor():
    graph = nx.path_graph(2)
    widget = GraphWidget(graph)
    send(widget, type="add_node", x=0.5, y=0.5)
    send(widget, type="add_edge", u=1, v=ids(widget)["2"])
    widget.arrange()
    assert set(widget.positions) == {str(i) for i in ids(widget).values()}


def test_arrange_reports_back_even_if_layout_fails(monkeypatch):
    widget = GraphWidget(nx.path_graph(3))
    sent = []
    widget.send = sent.append

    def broken():
        raise RuntimeError("layout bug")

    monkeypatch.setattr(widget, "_best_layout", broken)
    with pytest.raises(RuntimeError):
        widget.arrange()
    assert sent and sent[0]["type"] == "set_positions"


def test_arrange_empty_graph():
    widget = GraphWidget(nx.Graph())
    widget.arrange()
    assert widget.positions == {}
