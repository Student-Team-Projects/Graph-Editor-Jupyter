"""Arrange for looks (src/graph_editor_jupyter/looks.py, docs/research/08-layout-for-looks.md)."""

import math
import time

import networkx as nx
import numpy as np
import pytest

from graph_editor_jupyter import looks
from graph_editor_jupyter.layout import DEFAULT_SIZE, count_crossings, initial_layout, is_planar
from graph_editor_jupyter.looks import looks_layout, shown_symmetry

# The carpet graph of main.ipynb: fewest crossings gives a tangle, a circle gives a pattern.
CARPET = nx.circulant_graph(24, [1, 5, 7, 11])


def pixels(pos: dict) -> dict:
    return {v: (x * DEFAULT_SIZE[0], y * DEFAULT_SIZE[1]) for v, (x, y) in pos.items()}


def test_the_carpet_graph_is_drawn_as_a_circle_in_its_own_order():
    # The user (2026-11-23): circulant graphs look like carpet patterns on a circle; fewest
    # crossings (216) gives a tangle, the circle has 1152.
    p = pixels(looks_layout(CARPET))
    centre = np.mean(list(p.values()), axis=0)
    radii = [math.dist(q, centre) for q in p.values()]
    assert max(radii) / min(radii) < 1.01
    # Vertex i and i + 1 are neighbours on the circle: equal steps all the way round.
    angles = [math.atan2(p[i][1] - centre[1], p[i][0] - centre[0]) for i in range(24)]
    steps = [(angles[(i + 1) % 24] - angles[i]) % (2 * math.pi) for i in range(24)]
    assert max(abs(s - steps[0]) for s in steps) < 0.01
    assert min(steps[0], 2 * math.pi - steps[0]) == pytest.approx(2 * math.pi / 24, abs=0.01)


def test_petersen_is_a_pentagon_around_a_pentagram():
    pos = looks_layout(nx.petersen_graph())
    assert shown_symmetry(nx.petersen_graph(), pos) == 10  # 5 turns and 5 mirror images
    assert count_crossings(nx.petersen_graph(), pos) == 5


@pytest.mark.parametrize("graph, symmetry", [
    (nx.complete_graph(5), 10),
    (nx.cycle_graph(7), 14),
    (nx.hypercube_graph(3), 8),
    (nx.moebius_kantor_graph(), 16),
    (nx.heawood_graph(), 14),
])
def test_symmetric_graphs_show_their_symmetry(graph, symmetry):
    assert shown_symmetry(graph, looks_layout(graph)) == symmetry


@pytest.mark.parametrize("graph", [
    nx.dodecahedral_graph(), nx.hypercube_graph(3), nx.octahedral_graph(), nx.grid_2d_graph(4, 4),
    nx.wheel_graph(8), nx.gnp_random_graph(14, 0.3, seed=3),
], ids=["dodecahedron", "cube", "octahedron", "grid", "wheel", "random planar"])
def test_planar_graphs_stay_crossing_free(graph):
    # As in the first layout (docs/requirements.md): looks never cost a planar graph a crossing.
    assert is_planar(graph)
    assert count_crossings(graph, looks_layout(graph)) == 0


def test_the_dodecahedron_shows_its_five_fold_symmetry_without_crowding():
    # Tutte's drawing alone squeezed the inner pentagon until its vertices nearly touched.
    graph = nx.dodecahedral_graph()
    pos = looks_layout(graph)
    assert shown_symmetry(graph, pos) == 10
    p = pixels(pos)
    closest = min(math.dist(p[u], p[v]) for u in graph for v in graph if u != v)
    assert closest > 36  # MIN_VERTEX_GAP of the first layout


def test_a_grid_comes_out_square():
    # Symmetric drawings are stood upright: grid edges run level or upright, not as a diamond.
    graph = nx.grid_2d_graph(4, 4)
    p = pixels(looks_layout(graph))
    for u, v in graph.edges:
        angle = math.degrees(math.atan2(p[v][1] - p[u][1], p[v][0] - p[u][0])) % 90
        assert min(angle, 90 - angle) < 3


def test_trees_keep_the_layered_drawing_of_the_first_layout():
    tree = nx.balanced_tree(2, 3)
    assert looks_layout(tree) == initial_layout(tree)


def test_components_get_their_own_slots():
    graph = nx.disjoint_union(nx.petersen_graph(), nx.cycle_graph(6))
    pos = looks_layout(graph)
    first = [pos[v][0] for v in range(10)]
    second = [pos[v][0] for v in range(10, 16)]
    assert max(first) < min(second) or max(second) < min(first)


@pytest.mark.parametrize("graph", [nx.empty_graph(0), nx.empty_graph(1), nx.path_graph(2), nx.empty_graph(3)])
def test_tiny_graphs(graph):
    pos = looks_layout(graph)
    assert set(pos) == set(graph.nodes)
    assert all(0 <= x <= 1 and 0 <= y <= 1 for x, y in pos.values())


def test_multigraphs_and_self_loops_are_fine():
    graph = nx.MultiGraph(nx.petersen_graph())
    graph.add_edge(0, 1)
    graph.add_edge(3, 3)
    pos = looks_layout(graph)
    assert set(pos) == set(graph.nodes)
    assert shown_symmetry(nx.petersen_graph(), pos) == 10


def test_same_graph_same_drawing():
    assert looks_layout(nx.petersen_graph()) == looks_layout(nx.petersen_graph())


def test_bigger_graphs_finish_in_a_few_seconds():
    # The ring fit had a numeric gradient at first: a 10 x 10 grid took 19 s.
    for graph in [nx.grid_2d_graph(10, 10), nx.circulant_graph(60, [1, 7, 13]), nx.gnp_random_graph(300, 0.01, seed=1)]:
        start = time.monotonic()
        looks_layout(graph)
        assert time.monotonic() - start < 8


def test_shown_symmetry_counts_turns_and_mirror_images():
    hexagon = nx.cycle_graph(6)
    regular = {i: (0.5 + 0.4 * math.cos(math.pi * i / 3), 0.5 + 0.4 * math.sin(math.pi * i / 3)) for i in range(6)}
    assert shown_symmetry(hexagon, regular, (500, 500)) == 12
    bent = dict(regular)
    bent[0] = (0.95, 0.6)
    assert shown_symmetry(hexagon, bent, (500, 500)) == 1


def test_ring_stress_gradient_matches_finite_differences():
    graph = nx.petersen_graph()
    k, cycles, centre = looks._rotations(graph, time.monotonic() + 0.3)[0]
    _, _, stress, _ = looks._ring_model(cycles, centre, k, looks._distances(graph))
    rng = np.random.default_rng(1)
    radii, turns = rng.uniform(0.5, 2, len(cycles)), rng.uniform(0, 1, len(cycles))
    _, grad_r, grad_t = stress(radii, turns)
    eps = 1e-6
    for i in range(len(cycles)):
        bump = np.eye(len(cycles))[i] * eps
        assert grad_r[i] == pytest.approx((stress(radii + bump, turns)[0] - stress(radii - bump, turns)[0]) / (2 * eps), rel=1e-4, abs=1e-6)
        assert grad_t[i] == pytest.approx((stress(radii, turns + bump)[0] - stress(radii, turns - bump)[0]) / (2 * eps), rel=1e-4, abs=1e-6)


def test_fast_crossing_count_matches_the_plain_one():
    rng = np.random.default_rng(0)
    for seed in range(20):
        graph = nx.gnp_random_graph(12, 0.4, seed=seed)
        pos = {v: tuple(rng.random(2)) for v in graph}
        assert looks._crossings(graph, pos) == count_crossings(graph, pos)
