"""Initial vertex placement: crossing-free for planar graphs, with vertices spread apart.

Positions are returned normalized to [0, 1] x [0, 1]; the front end maps that square onto the
drawing area (`size`). Quality is measured in pixels of that area. Layouts keep their proportions
(a circle stays a circle), except layered tree drawings, which may stretch.
"""

import math
import time
from itertools import combinations

import networkx as nx
import numpy as np

Point = tuple[float, float]

DEFAULT_SIZE = (760, 460)  # drawing area of the default 800 x 500 widget minus padding
SPRING_SEEDS = range(8)
REFINE_STEPS = 150
MAX_EDGES_FOR_SEARCH = 400  # above this, skip the candidate search (crossing count is O(E^2))
MAX_NODES_FOR_ALL_CANDIDATES = 120  # above this, skip the slow Kamada-Kawai and extra spring seeds
GOOD_CLEARANCE = 40  # pixels; layouts with at least this much space are not refined
REFINE_SECONDS = 1.0  # time budget for refining one component


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


def _point_segment_distance(p: Point, a: Point, b: Point) -> float:
    ax, ay = a
    dx, dy = b[0] - ax, b[1] - ay
    length2 = dx * dx + dy * dy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / length2))
    return math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))


def clearance(graph: nx.Graph, pos: dict, size: tuple[int, int] = DEFAULT_SIZE) -> float:
    """Smallest gap in pixels: vertex to vertex, or vertex to an edge it isn't part of."""
    px = {v: (x * size[0], y * size[1]) for v, (x, y) in pos.items()}
    best = math.inf
    for u, v in combinations(graph.nodes, 2):
        best = min(best, math.dist(px[u], px[v]))
    for w in graph.nodes:
        for a, b in graph.edges:
            if w not in (a, b):
                best = min(best, _point_segment_distance(px[w], px[a], px[b]))
    return best


def _normalize(pos: dict, size: tuple[int, int], keep_aspect: bool = True) -> dict[object, Point]:
    """Fit positions into the drawing area, centered. With keep_aspect, both axes get the
    same scale, so shapes are not distorted. Either way the map is affine: crossings are preserved."""
    if not pos:
        return {}
    xs = [p[0] for p in pos.values()]
    ys = [p[1] for p in pos.values()]
    span_x = max(xs) - min(xs)
    span_y = max(ys) - min(ys)
    # Pixels per layout unit on each axis; a zero span (all on one line) doesn't limit the scale.
    sx = size[0] / span_x if span_x > 1e-12 else math.inf
    sy = size[1] / span_y if span_y > 1e-12 else math.inf
    if keep_aspect:
        sx = sy = min(sx, sy)
    if math.isinf(sx):
        sx = 0.0
    if math.isinf(sy):
        sy = 0.0
    off_x = (size[0] - span_x * sx) / 2
    off_y = (size[1] - span_y * sy) / 2
    def unit(value: float) -> float:
        return min(max(value, 0.0), 1.0)  # absorb floating-point rounding at the edges

    return {
        node: (unit((off_x + (x - min(xs)) * sx) / size[0]), unit((off_y + (y - min(ys)) * sy) / size[1]))
        for node, (x, y) in pos.items()
    }


def _faces(embedding: nx.PlanarEmbedding) -> list[list]:
    seen = set()
    faces = []
    for u, v in embedding.edges:
        if (u, v) not in seen:
            faces.append(embedding.traverse_face(u, v, mark_half_edges=seen))
    return faces


def tutte_layout(graph: nx.Graph) -> dict:
    """Tutte embedding: the largest face on a circle, every other vertex at the
    average of its neighbours. Crossing-free with convex faces for 3-connected planar graphs."""
    _, embedding = nx.check_planarity(graph)
    outer = max(_faces(embedding), key=len)
    pos = {
        v: (math.cos(2 * math.pi * i / len(outer)), math.sin(2 * math.pi * i / len(outer)))
        for i, v in enumerate(outer)
    }
    inner = [v for v in graph.nodes if v not in pos]
    if inner:
        index = {v: i for i, v in enumerate(inner)}
        a = np.zeros((len(inner), len(inner)))
        b = np.zeros((len(inner), 2))
        for v in inner:
            row = index[v]
            a[row, row] = graph.degree(v)
            for w in graph.neighbors(v):
                if w in index:
                    a[row, index[w]] -= 1
                else:
                    b[row] += pos[w]
        solution = np.linalg.solve(a, b)
        pos.update({v: tuple(solution[index[v]]) for v in inner})
    return pos


def tree_layout(graph: nx.Graph) -> dict:
    """Layered drawing of a tree, rooted at its center: leaves spaced evenly,
    each parent above the middle of its children. Always crossing-free."""
    root = nx.center(graph)[0]
    pos = {}
    next_leaf = 0

    def place(v, parent, depth) -> float:
        nonlocal next_leaf
        children = [w for w in graph.neighbors(v) if w != parent]
        if children:
            x = sum(place(w, v, depth + 1) for w in children) / len(children)
        else:
            x = next_leaf
            next_leaf += 1
        pos[v] = (x, depth)
        return x

    place(root, None, 0)
    return pos


def _candidates(graph: nx.Graph, seed: int, size: tuple[int, int]) -> list[dict]:
    candidates = []
    stretched = []
    if nx.is_tree(graph):
        stretched.append(tree_layout(graph))
    if graph.number_of_nodes() >= 4 and is_planar(graph) and nx.node_connectivity(graph) >= 3:
        candidates.append(tutte_layout(graph))
    small = graph.number_of_nodes() <= MAX_NODES_FOR_ALL_CANDIDATES
    if small:
        candidates.append(nx.kamada_kawai_layout(graph))
    for offset in SPRING_SEEDS if small else [0]:
        candidates.append(nx.spring_layout(graph, seed=seed + offset))
    if is_planar(graph):
        candidates.append(nx.planar_layout(graph))
    def as_floats(c: dict) -> dict:
        return {v: (float(x), float(y)) for v, (x, y) in c.items()}

    return [_normalize(as_floats(c), size, keep_aspect=False) for c in stretched] + [
        _normalize(as_floats(c), size) for c in candidates
    ]


def _creates_crossing(graph: nx.Graph, pos: dict, moved, new: Point) -> bool:
    for w in graph.neighbors(moved):
        for a, b in graph.edges:
            if {a, b} & {moved, w}:
                continue
            if _segments_cross(new, pos[w], pos[a], pos[b]):
                return True
    return False


def _refine(graph: nx.Graph, pos: dict, size: tuple[int, int]) -> dict:
    """Spread vertices apart with a simple force step, rejecting any move that adds a crossing."""
    pos = {v: (p[0] * size[0], p[1] * size[1]) for v, p in pos.items()}
    ideal = math.sqrt(size[0] * size[1] / max(1, graph.number_of_nodes()))
    step = ideal / 4
    deadline = time.monotonic() + REFINE_SECONDS
    for _ in range(REFINE_STEPS):
        if time.monotonic() > deadline:
            break
        for v in graph.nodes:
            fx = fy = 0.0
            for w in graph.nodes:
                if w == v:
                    continue
                dx = pos[v][0] - pos[w][0]
                dy = pos[v][1] - pos[w][1]
                d = max(math.hypot(dx, dy), 1e-6)
                fx += dx / d * ideal * ideal / d  # repulsion
                fy += dy / d * ideal * ideal / d
            for w in graph.neighbors(v):
                dx = pos[w][0] - pos[v][0]
                dy = pos[w][1] - pos[v][1]
                d = max(math.hypot(dx, dy), 1e-6)
                fx += dx / d * d * d / ideal  # attraction along edges
                fy += dy / d * d * d / ideal
            norm = math.hypot(fx, fy)
            if norm < 1e-9:
                continue
            move = min(step, norm)
            new = (
                min(max(pos[v][0] + fx / norm * move, 0.0), size[0]),
                min(max(pos[v][1] + fy / norm * move, 0.0), size[1]),
            )
            if not _creates_crossing(graph, pos, v, new):
                pos[v] = new
        step *= 0.97
    return _normalize(pos, size)


def _layout_component(graph: nx.Graph, seed: int, size: tuple[int, int]) -> dict:
    if graph.number_of_nodes() == 1:
        return {next(iter(graph.nodes)): (0.5, 0.5)}
    if graph.number_of_edges() > MAX_EDGES_FOR_SEARCH:
        pos = nx.planar_layout(graph) if is_planar(graph) else nx.spring_layout(graph, seed=seed)
        return _normalize({v: (float(x), float(y)) for v, (x, y) in pos.items()}, size)

    # Fewest crossings first, then the most space between vertices.
    scored = [
        (-count_crossings(graph, pos), clearance(graph, pos, size), i, pos)
        for i, pos in enumerate(_candidates(graph, seed, size))
    ]
    neg_crossings, space, _, best = max(scored, key=lambda item: item[:3])
    if neg_crossings == 0 and space < GOOD_CLEARANCE:
        refined = _refine(graph, best, size)
        if clearance(graph, refined, size) > space:
            best = refined
    return best


def initial_layout(graph: nx.Graph, seed: int = 0, size: tuple[int, int] = DEFAULT_SIZE) -> dict[object, Point]:
    """Positions in [0, 1] x [0, 1]. Planar graphs get a crossing-free layout.

    Connected components are laid out separately and placed side by side.
    """
    components = sorted(nx.connected_components(graph), key=len, reverse=True)
    if not components:
        return {}
    # Give each component a horizontal slot proportional to its size.
    total = sum(len(c) for c in components)
    gap = 0.04
    usable = 1 - gap * (len(components) - 1)
    pos = {}
    left = 0.0
    for component in components:
        width = usable * len(component) / total
        sub = _layout_component(graph.subgraph(component), seed, (max(1, int(size[0] * width)), size[1]))
        for v, (x, y) in sub.items():
            pos[v] = (left + x * width, y)
        left += width + gap
    return pos
