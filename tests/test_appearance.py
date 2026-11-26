"""How vertices and edges look (src/graph_editor_jupyter/appearance.py; docs/requirements.md,
"Labels"). The user (2026-11-26): weights, colors, names, sizes, widths and directions must
show in the editor."""

import math

import networkx as nx
import pytest

from graph_editor_jupyter import GraphWidget
from graph_editor_jupyter.appearance import css_color, edge_view, node_view


def by_label(widget: GraphWidget) -> dict:
    return {n["label"]: n for n in widget.nodes}


def edge(widget: GraphWidget, u_label: str, v_label: str) -> dict:
    ids = {n["label"]: n["id"] for n in widget.nodes}
    return next(e for e in widget.edges if (e["u"], e["v"]) == (ids[u_label], ids[v_label]))


# ---- vertices ----

def test_a_vertex_is_named_after_its_node_unless_it_has_a_label():
    assert node_view(("a", 1), {}) == {"label": "('a', 1)"}
    assert node_view(7, {"label": "Kraków"})["label"] == "Kraków"
    assert node_view(7, {"label": 3})["label"] == "3"


def test_vertex_color_and_size():
    view = node_view(0, {"color": "tomato", "size": 50})
    assert view == {"label": "0", "color": "tomato", "size": 50}


@pytest.mark.parametrize("size, expected", [(1, 8), (500, 200), (0, None), (-5, None), (True, None), ("big", None), (math.nan, None)])
def test_vertex_size_is_kept_sensible(size, expected):
    assert node_view(0, {"size": size}).get("size") == expected


# ---- edges ----

@pytest.mark.parametrize("weight, shown", [(3, "3"), (2.5, "2.5"), (0.1 + 0.2, "0.3"), ("high", "high"), (1e-7, "1e-07")])
def test_an_edge_shows_its_weight(weight, shown):
    assert edge_view({"weight": weight}) == {"label": shown}


def test_an_edge_label_wins_over_its_weight():
    assert edge_view({"weight": 4, "label": "road"})["label"] == "road"


def test_edge_color_and_width():
    assert edge_view({"color": "#1f77b4", "width": 4}) == {"color": "#1f77b4", "width": 4}
    assert edge_view({"width": 100})["width"] == 20
    assert "width" not in edge_view({"width": 0})


def test_an_edge_without_attributes_looks_plain():
    assert edge_view({}) == {}


# ---- colors ----

@pytest.mark.parametrize("value, css", [
    ("red", "red"), (" #ff0000 ", "#ff0000"), ((1.0, 0.5, 0.0), "rgb(255, 128, 0)"),
    ((255, 128, 0), "rgb(255, 128, 0)"), ((0, 0, 1, 0.5), "rgba(0, 0, 255, 0.5)"),
    ("", None), (None, None), (42, None), ((1, 2), None), (("a", "b", "c"), None),
])
def test_colors_as_css(value, css):
    assert css_color(value) == css


# ---- in the widget ----

def test_the_widget_sends_the_look_of_vertices_and_edges():
    graph = nx.Graph()
    graph.add_node("a", color="red", size=40, label="Start")
    graph.add_node("b")
    graph.add_edge("a", "b", weight=5, color="blue", width=3)
    widget = GraphWidget(graph)
    nodes = by_label(widget)
    assert nodes["Start"]["color"] == "red" and nodes["Start"]["size"] == 40
    assert set(nodes["b"]) == {"id", "label"}
    assert edge(widget, "Start", "b") == {"u": nodes["Start"]["id"], "v": nodes["b"]["id"], "label": "5", "color": "blue", "width": 3}
    assert widget.directed is False


def test_changes_made_in_python_show_after_the_next_edit():
    graph = nx.path_graph(2)
    widget = GraphWidget(graph)
    graph.nodes[0]["color"] = "green"
    graph.edges[0, 1]["weight"] = 9
    widget._on_msg(widget, {"type": "move"}, [])
    assert by_label(widget)["0"]["color"] == "green"
    assert edge(widget, "0", "1")["label"] == "9"


def test_undo_brings_back_the_look_too():
    graph = nx.Graph()
    graph.add_edge(0, 1, weight=2, color="red")
    widget = GraphWidget(graph)
    ids = {n["label"]: n["id"] for n in widget.nodes}
    widget._on_msg(widget, {"type": "remove_edge", "u": ids["0"], "v": ids["1"]}, [])
    assert widget.edges == []
    widget.undo()
    assert edge(widget, "0", "1")["label"] == "2"
    assert graph.edges[0, 1] == {"weight": 2, "color": "red"}


# ---- directed graphs ----

def test_a_directed_graph_keeps_its_directions():
    graph = nx.DiGraph([("a", "b"), ("b", "a"), ("b", "c")])
    widget = GraphWidget(graph)
    assert widget.directed is True
    ids = {n["label"]: n["id"] for n in widget.nodes}
    sent = {(e["u"], e["v"]) for e in widget.edges}
    assert sent == {(ids["a"], ids["b"]), (ids["b"], ids["a"]), (ids["b"], ids["c"])}


def test_an_edge_drawn_in_a_directed_graph_goes_from_the_first_click_to_the_second():
    graph = nx.DiGraph([(0, 1)])
    widget = GraphWidget(graph)
    ids = {n["label"]: n["id"] for n in widget.nodes}
    widget._on_msg(widget, {"type": "add_edge", "u": ids["1"], "v": ids["0"]}, [])
    assert set(graph.edges) == {(0, 1), (1, 0)}
    widget._on_msg(widget, {"type": "add_edge", "u": ids["1"], "v": ids["0"]}, [])  # already there
    assert graph.number_of_edges() == 2
    widget._on_msg(widget, {"type": "remove_edge", "u": ids["0"], "v": ids["1"]}, [])
    assert set(graph.edges) == {(1, 0)}


def test_directed_graphs_are_laid_out_like_undirected_ones():
    # Direction doesn't change where vertices go: the layout sees one line per pair.
    directed = nx.DiGraph(nx.petersen_graph())
    directed.remove_edges_from([(v, u) for u, v in nx.petersen_graph().edges])  # one direction each
    assert GraphWidget(directed).positions == GraphWidget(nx.petersen_graph()).positions
    both_ways = nx.DiGraph(nx.dodecahedral_graph())  # u -> v and v -> u for every edge
    assert GraphWidget(both_ways).positions == GraphWidget(nx.dodecahedral_graph()).positions


def test_a_directed_graph_can_be_arranged_both_ways():
    widget = GraphWidget(nx.DiGraph(nx.cycle_graph(6)))
    for mode in ("crossings", "looks"):
        widget.arrange(mode=mode)
        assert len(widget.positions) == 6
