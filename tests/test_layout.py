import networkx as nx
import pytest

from graph_editor_jupyter.layout import (
    clearance,
    count_crossings,
    initial_layout,
    is_planar,
    tree_layout,
    tutte_layout,
)

NON_PLANAR = {
    "K5": nx.complete_graph(5),
    "K3,3": nx.complete_bipartite_graph(3, 3),
    "Petersen": nx.petersen_graph(),
}

PLANAR = {
    "empty": nx.empty_graph(0),
    "single vertex": nx.empty_graph(1),
    "path": nx.path_graph(6),
    "cycle": nx.cycle_graph(7),
    "star": nx.star_graph(10),
    "tree": nx.balanced_tree(2, 4),
    "K4": nx.complete_graph(4),
    "cube": nx.hypercube_graph(3),
    "grid": nx.grid_2d_graph(4, 5),
    "wheel": nx.wheel_graph(8),
    "dodecahedron": nx.dodecahedral_graph(),
    "disconnected": nx.disjoint_union(nx.cycle_graph(4), nx.complete_graph(4)),
}


@pytest.mark.parametrize("name", NON_PLANAR)
def test_non_planar_graphs_are_detected(name):
    assert not is_planar(NON_PLANAR[name])


@pytest.mark.parametrize("name", PLANAR)
def test_planar_graphs_are_detected(name):
    assert is_planar(PLANAR[name])


@pytest.mark.parametrize("name", PLANAR)
def test_planar_layout_has_no_crossings(name):
    graph = PLANAR[name]
    pos = initial_layout(graph)
    assert count_crossings(graph, pos) == 0


@pytest.mark.parametrize("name", {**PLANAR, **NON_PLANAR})
def test_layout_is_normalized(name):
    graph = {**PLANAR, **NON_PLANAR}[name]
    pos = initial_layout(graph)
    assert set(pos) == set(graph.nodes)
    for x, y in pos.values():
        assert 0 <= x <= 1 and 0 <= y <= 1


# Vertices are drawn with radius 16 px: below this gap they overlap or sit on edges.
MIN_CLEARANCE = 30


@pytest.mark.parametrize("name", [n for n, g in PLANAR.items() if g.number_of_nodes() >= 2])
def test_planar_layout_has_no_overlaps(name):
    graph = PLANAR[name]
    assert clearance(graph, initial_layout(graph)) >= MIN_CLEARANCE


@pytest.mark.parametrize("graph", [nx.complete_graph(4), nx.hypercube_graph(3), nx.wheel_graph(8), nx.dodecahedral_graph()])
def test_tutte_layout_is_crossing_free_for_3_connected(graph):
    assert count_crossings(graph, tutte_layout(graph)) == 0


@pytest.mark.parametrize("graph", [nx.path_graph(9), nx.star_graph(6), nx.balanced_tree(3, 3), nx.random_labeled_tree(40, seed=3)])
def test_tree_layout_is_crossing_free(graph):
    assert count_crossings(graph, tree_layout(graph)) == 0


def test_layout_keeps_proportions():
    # A cycle is drawn as a regular polygon; stretching would turn it into an ellipse.
    pos = initial_layout(nx.cycle_graph(12))
    xs = [x * 760 for x, _ in pos.values()]
    ys = [y * 460 for _, y in pos.values()]
    width, height = max(xs) - min(xs), max(ys) - min(ys)
    assert abs(width - height) / max(width, height) < 0.05


def test_layout_is_deterministic():
    graph = nx.petersen_graph()
    assert initial_layout(graph) == initial_layout(graph)


def test_count_crossings_square_with_diagonals():
    graph = nx.complete_graph(4)
    pos = {0: (0, 0), 1: (1, 0), 2: (1, 1), 3: (0, 1)}
    assert count_crossings(graph, pos) == 1


def test_shared_endpoint_is_not_a_crossing():
    graph = nx.Graph([(0, 1), (0, 2)])
    pos = {0: (0, 0), 1: (1, 0), 2: (0, 1)}
    assert count_crossings(graph, pos) == 0
