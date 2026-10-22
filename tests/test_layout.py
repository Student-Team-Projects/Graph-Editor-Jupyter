import networkx as nx
import pytest

from graph_editor_jupyter.layout import count_crossings, initial_layout, is_planar

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


def test_count_crossings_square_with_diagonals():
    graph = nx.complete_graph(4)
    pos = {0: (0, 0), 1: (1, 0), 2: (1, 1), 3: (0, 1)}
    assert count_crossings(graph, pos) == 1


def test_shared_endpoint_is_not_a_crossing():
    graph = nx.Graph([(0, 1), (0, 2)])
    pos = {0: (0, 0), 1: (1, 0), 2: (0, 1)}
    assert count_crossings(graph, pos) == 0
