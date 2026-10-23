import networkx as nx
import numpy as np
import pytest

from graph_editor_jupyter.layout import (
    DEFAULT_SIZE,
    _CrossingSearch,
    badness,
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


# Known crossing numbers: the minimum possible crossings in any straight-line drawing.
CROSSING_NUMBERS = {
    "K5": (nx.complete_graph(5), 1),
    "K6": (nx.complete_graph(6), 3),
    "K7": (nx.complete_graph(7), 9),
    "K3,3": (nx.complete_bipartite_graph(3, 3), 1),
    "K3,4": (nx.complete_bipartite_graph(3, 4), 2),
    "K4,4": (nx.complete_bipartite_graph(4, 4), 4),
    "Petersen": (nx.petersen_graph(), 2),
    "Heawood": (nx.heawood_graph(), 3),
}


@pytest.mark.parametrize("name", CROSSING_NUMBERS)
def test_non_planar_layout_reaches_the_crossing_number(name):
    graph, minimum = CROSSING_NUMBERS[name]
    pos = initial_layout(graph)
    assert count_crossings(graph, pos) == minimum
    # No edge may pass through or graze a vertex to fake a lower count.
    assert badness(graph, pos) == minimum


def test_crossing_search_beats_plain_layouts_on_a_bigger_graph():
    graph = nx.random_regular_graph(3, 40, seed=1)
    plain = min(count_crossings(graph, nx.spring_layout(graph, seed=s)) for s in range(8))
    assert count_crossings(graph, initial_layout(graph)) <= 0.75 * plain  # measured: 13 vs 21


def test_edge_through_a_vertex_is_not_better_than_a_crossing():
    # Regression: K5 drawn with a vertex lying exactly on an edge has no proper crossing,
    # but it looks like one and must score worse than K5's one unavoidable crossing.
    graph = nx.complete_graph(5)
    pos = {0: (0.0, 0.0), 1: (1.0, 0.0), 2: (0.5, 1.0), 3: (0.5, 0.4), 4: (0.5, 0.0)}  # 4 lies on edge 0-1
    assert count_crossings(graph, pos) == 0
    assert badness(graph, pos) > 1


@pytest.mark.parametrize("graph", [nx.complete_graph(5), nx.petersen_graph(), nx.random_regular_graph(3, 12, seed=2)])
def test_local_scores_match_the_global_score(graph):
    # Regression: the search compares spots using only the terms that change when one vertex
    # moves. If those disagree with badness(), the search goes round in circles.
    rng = np.random.default_rng(0)
    search = _CrossingSearch(graph, DEFAULT_SIZE, seed=0)
    p = rng.uniform(0, 1, (len(search.nodes), 2)) * DEFAULT_SIZE
    for i in range(len(search.nodes)):
        spots = np.vstack([p[i], rng.uniform(0, 1, (20, 2)) * DEFAULT_SIZE])
        local = search.spot_scores(p, i, spots)
        for k in range(1, len(spots)):
            moved = p.copy()
            moved[i] = spots[k]
            assert local[k] - local[0] == search.score(moved) - search.score(p)


@pytest.mark.parametrize("graph", [nx.complete_graph(5), nx.petersen_graph(), nx.random_regular_graph(3, 12, seed=2)])
def test_local_energy_matches_the_global_energy(graph):
    # Same guard for the second phase: spot_energy must change exactly like energy().
    rng = np.random.default_rng(1)
    search = _CrossingSearch(graph, DEFAULT_SIZE, seed=0)
    p = rng.uniform(0, 1, (len(search.nodes), 2)) * DEFAULT_SIZE
    for i in range(len(search.nodes)):
        spots = np.vstack([p[i], rng.uniform(0, 1, (10, 2)) * DEFAULT_SIZE])
        local = search.spot_energy(p, i, spots)
        for k in range(1, len(spots)):
            moved = p.copy()
            moved[i] = spots[k]
            assert local[k] - local[0] == pytest.approx(search.energy(moved) - search.energy(p), rel=1e-6, abs=1e-6)
