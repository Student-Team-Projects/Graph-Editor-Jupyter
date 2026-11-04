import networkx as nx
import numpy as np
import pytest

from graph_editor_jupyter import layout as layout_module
from graph_editor_jupyter.layout import (
    DEFAULT_SIZE,
    _CrossingSearch,
    _candidates,
    _planar_subgraph,
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


@pytest.mark.parametrize("graph", [nx.cubical_graph(), nx.grid_2d_graph(4, 5)])
@pytest.mark.parametrize("size", [(100, 60), (60, 100)])
def test_cramped_planar_layout_keeps_zero_crossings(graph, size):
    # Near-miss penalties in a small area must not make a crossing candidate win.
    pos = initial_layout(graph, size=size)
    assert set(pos) == set(graph)
    assert count_crossings(graph, pos) == 0
    assert all(0 <= x <= 1 and 0 <= y <= 1 for x, y in pos.values())


def test_planar_components_keep_zero_crossings_in_small_slots():
    graph = nx.disjoint_union_all(nx.cubical_graph() for _ in range(4))
    pos = initial_layout(graph, size=(200, 120))
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


@pytest.mark.parametrize("weight", [-1, 0, 100, "label"])
def test_layout_candidates_ignore_edge_weights(weight):
    graph = nx.cycle_graph(4)
    expected = _candidates(graph, seed=0, size=DEFAULT_SIZE)
    nx.set_edge_attributes(graph, weight, "weight")
    assert _candidates(graph, seed=0, size=DEFAULT_SIZE) == expected
    assert all(data["weight"] == weight for *_, data in graph.edges(data=True))


def test_widget_opens_graph_with_negative_edge_weight():
    from graph_editor_jupyter import GraphWidget

    graph = nx.Graph([(0, 1, {"weight": -1})])
    widget = GraphWidget(graph)
    assert len(widget.positions) == 2
    assert graph[0][1]["weight"] == -1


@pytest.mark.parametrize("weight", ["label", float("nan")])
def test_planarization_ignores_edge_weights(weight):
    graph = nx.complete_graph(5)
    expected = _planar_subgraph(graph)
    nx.set_edge_attributes(graph, weight, "weight")
    subgraph = _planar_subgraph(graph)
    assert set(subgraph) == set(expected)
    assert set(subgraph.edges) == set(expected.edges)
    assert is_planar(subgraph) and nx.is_connected(subgraph)
    # Constructing the widget exercises planarization through initial_layout too.
    from graph_editor_jupyter import GraphWidget

    widget = GraphWidget(graph)
    assert len(widget.positions) == len(graph)
    assert all(data["weight"] is weight for *_, data in graph.edges(data=True))


def test_large_non_planar_layout_ignores_edge_weights(monkeypatch):
    monkeypatch.setattr("graph_editor_jupyter.layout.MAX_EDGES_FOR_SEARCH", 0)
    graph = nx.complete_graph(5)
    expected = initial_layout(graph)
    nx.set_edge_attributes(graph, -1, "weight")
    assert initial_layout(graph) == expected


@pytest.mark.parametrize("count", [4, 26, 27, 100])
@pytest.mark.parametrize("size", [(760, 460), (300, 900)])
def test_many_components_have_positive_separate_slots(monkeypatch, count, size):
    graph = nx.disjoint_union_all(nx.path_graph(3 + i % 4) for i in range(count))
    slots = []

    def component_layout(component, seed, component_size):
        slots.append((list(component), component_size))
        # Fill both dimensions to expose collapsed or reversed component slots.
        return {v: (i / (len(component) - 1),) * 2 for i, v in enumerate(component)}

    monkeypatch.setattr("graph_editor_jupyter.layout._layout_component", component_layout)
    pos = initial_layout(graph, size=size)
    assert set(pos) == set(graph)
    boxes = []
    for nodes, pixel_size in slots:
        points = np.array([pos[v] for v in nodes])
        low, high = points.min(axis=0), points.max(axis=0)
        assert np.all(low >= 0) and np.all(high <= 1)
        assert np.all(high > low)
        assert all(abs(pixels - s * span) <= 1 for pixels, s, span in zip(pixel_size, size, high - low))
        boxes.append((low, high))
    assert len({low[1] for low, _ in boxes}) > 1
    for i, (low, high) in enumerate(boxes):
        for other_low, other_high in boxes[i + 1:]:
            assert np.any(high < other_low) or np.any(other_high < low)


@pytest.mark.parametrize("count", [26, 27, 1000])
def test_many_isolated_vertices_are_distinct_and_normalized(count):
    pos = initial_layout(nx.empty_graph(count))
    assert len(set(pos.values())) == count
    assert all(0 <= x <= 1 and 0 <= y <= 1 for x, y in pos.values())
    assert len({y for _, y in pos.values()}) > 1


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
def test_non_planar_layout_reaches_the_crossing_number(name, monkeypatch):
    # Regression: the search stops on a time budget, so on a slower setup Heawood got 4 crossings
    # and this test failed. It checks what the search can reach, not how fast the machine is.
    monkeypatch.setattr(layout_module, "SEARCH_SECONDS", layout_module.SEARCH_SECONDS * 4)
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


@pytest.mark.parametrize("batch_elements", [1_000_000, 100, 1])
@pytest.mark.parametrize("graph", [nx.complete_graph(5), nx.petersen_graph(), nx.random_regular_graph(3, 12, seed=2)])
def test_local_scores_match_the_global_score(graph, batch_elements, monkeypatch):
    # Regression: the search compares spots using only the terms that change when one vertex
    # moves. If those disagree with badness(), the search goes round in circles.
    monkeypatch.setattr("graph_editor_jupyter.layout.SCORING_BATCH_ELEMENTS", batch_elements)
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


@pytest.mark.parametrize("batch_elements", [1_000_000, 100, 1])
@pytest.mark.parametrize("graph", [nx.complete_graph(5), nx.petersen_graph(), nx.random_regular_graph(3, 12, seed=2)])
def test_local_energy_matches_the_global_energy(graph, batch_elements, monkeypatch):
    # Same guard for the second phase: spot_energy must change exactly like energy().
    monkeypatch.setattr("graph_editor_jupyter.layout.SCORING_BATCH_ELEMENTS", batch_elements)
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


@pytest.mark.parametrize("method", ["spot_scores", "spot_energy"])
def test_high_degree_candidate_scoring_bounds_broadcasts(method, monkeypatch):
    from graph_editor_jupyter import layout

    graph = nx.complete_graph(5)
    graph.add_edges_from((0, node) for node in range(5, 395))
    assert graph.number_of_edges() == 400 and graph.degree(0) == 394
    search = _CrossingSearch(graph, DEFAULT_SIZE, seed=0)
    p = np.random.default_rng(0).uniform(0, 1, (len(graph), 2)) * DEFAULT_SIZE
    spots = np.vstack([p[0], p[search.neighbours[0]].mean(axis=0), search.grid])
    budget = 1_000_000

    def bounded(function):
        def checked(a, b, c):
            # Check before allocating: the old implementation would need gigabytes.
            shape = np.broadcast_shapes(a.shape[:-1], b.shape[:-1], c.shape[:-1])
            assert np.prod(shape) <= budget, f"oversized scoring broadcast: {shape}"
            return function(a, b, c)
        return checked

    monkeypatch.setattr(layout, "_orient", bounded(layout._orient))
    monkeypatch.setattr(layout, "_segment_distance", bounded(layout._segment_distance))
    values = getattr(search, method)(p, 0, spots)
    assert values.shape == (len(spots),)
    assert np.isfinite(values).all()
