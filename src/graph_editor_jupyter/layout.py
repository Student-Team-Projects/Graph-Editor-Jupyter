"""Initial vertex placement: crossing-free for planar graphs."""

from itertools import combinations

import networkx as nx

Point = tuple[float, float]


def is_planar(graph: nx.Graph) -> bool:
    # check_planarity returns (is_planar, embedding); the tuple itself is always truthy.
    planar, _ = nx.check_planarity(graph)
    return planar


def _orientation(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _segments_cross(p1: Point, p2: Point, q1: Point, q2: Point) -> bool:
    """True if the segments properly intersect (touching endpoints doesn't count)."""
    d1 = _orientation(q1, q2, p1)
    d2 = _orientation(q1, q2, p2)
    d3 = _orientation(p1, p2, q1)
    d4 = _orientation(p1, p2, q2)
    return d1 * d2 < 0 and d3 * d4 < 0


def count_crossings(graph: nx.Graph, pos: dict) -> int:
    """Number of pairs of edges that cross, ignoring pairs sharing a vertex."""
    crossings = 0
    for (a, b), (c, d) in combinations(graph.edges, 2):
        if {a, b} & {c, d}:
            continue
        if _segments_cross(pos[a], pos[b], pos[c], pos[d]):
            crossings += 1
    return crossings


def _normalize(pos: dict) -> dict[object, Point]:
    """Scale positions into [0, 1] x [0, 1], keeping the aspect ratio."""
    if not pos:
        return {}
    xs = [p[0] for p in pos.values()]
    ys = [p[1] for p in pos.values()]
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    if span == 0:
        return {node: (0.5, 0.5) for node in pos}
    off_x = (1 - (max(xs) - min(xs)) / span) / 2
    off_y = (1 - (max(ys) - min(ys)) / span) / 2
    return {
        node: (off_x + (x - min(xs)) / span, off_y + (y - min(ys)) / span)
        for node, (x, y) in pos.items()
    }


def initial_layout(graph: nx.Graph, seed: int = 0) -> dict[object, Point]:
    """Positions in [0, 1] x [0, 1]. Planar graphs get a crossing-free layout."""
    if graph.number_of_nodes() == 0:
        return {}
    if is_planar(graph):
        pos = nx.planar_layout(graph)
    else:
        # TODO: minimize crossings for non-planar graphs (docs/requirements.md).
        pos = nx.spring_layout(graph, seed=seed)
    return _normalize({node: (float(x), float(y)) for node, (x, y) in pos.items()})
