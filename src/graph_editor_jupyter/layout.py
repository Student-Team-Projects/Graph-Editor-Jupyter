"""Initial vertex placement: crossing-free for planar graphs, few crossings for the rest,
with vertices spread apart.

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

# Crossing minimization for non-planar graphs (local search, see _reduce_crossings).
SEARCH_SECONDS = 1.6  # time budget for the crossing phase of one component
POLISH_SECONDS = 0.8  # time budget for the stress phase
SEARCH_GRID = (32, 20)  # candidate spots per axis when moving a vertex
SCORING_BATCH_ELEMENTS = 1_000_000  # target broadcast elements per batch (at least one spot)
MIN_VERTEX_GAP = 36.0  # pixels kept between vertex centres (two radii plus a little)
MIN_EDGE_GAP = 18.0  # pixels kept between a vertex and an edge it isn't part of
# A near-miss (edge through or grazing a vertex, vertices on top of each other) is ambiguous:
# you can't tell if the edge ends at the vertex. It can also hide several crossings, so it
# must cost far more than one crossing, or the search trades real crossings for hidden ones.
NEAR_MISS_COST = 10
SEARCH_STARTS = 3  # best candidate layouts the search starts from
SHAKE_ROUNDS = 40  # stop after this many shakes in a row without improvement
SHAKE_VERTICES = 4  # vertices moved to random spots in one shake (3 missed Heawood's optimum)
ENERGY_MARGIN = 1e-3  # smallest energy gain that counts as an improvement
CLEARANCE_GOAL = 40.0  # pixels; closer than this, a vertex is pushed away from an edge (Davidson-Harel)
RELAX_STEPS = 200  # stress majorization passes in the polish phase


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
    # Layout uses topology only: edge attributes may contain negative or nonnumeric weights.
    if small:
        candidates.append(nx.kamada_kawai_layout(graph, weight=None))
    for offset in SPRING_SEEDS if small else [0]:
        candidates.append(nx.spring_layout(graph, seed=seed + offset, weight=None))
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


def _planar_subgraph(graph: nx.Graph) -> nx.Graph:
    """A large planar subgraph: a spanning forest (always planar), then every other edge
    that keeps it planar. The first step of the planarization method."""
    sub = nx.Graph()
    sub.add_nodes_from(graph.nodes)
    sub.add_edges_from(nx.minimum_spanning_edges(graph, weight=None, data=False))
    for u, v in graph.edges:
        if u == v or sub.has_edge(u, v):
            continue
        sub.add_edge(u, v)
        if not is_planar(sub):
            sub.remove_edge(u, v)
    return sub


def _orient(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    return (b[..., 0] - a[..., 0]) * (c[..., 1] - a[..., 1]) - (b[..., 1] - a[..., 1]) * (c[..., 0] - a[..., 0])


def _segment_distance(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Distance from points p to segments ab, broadcasting over leading axes."""
    ab = b - a
    length2 = np.maximum((ab**2).sum(-1), 1e-12)
    t = np.clip(((p - a) * ab).sum(-1) / length2, 0.0, 1.0)
    return np.linalg.norm(p - (a + t[..., None] * ab), axis=-1)


def _violations(graph: nx.Graph, pos: dict, size: tuple[int, int]) -> int:
    """Near-misses that look like crossings: vertices closer than MIN_VERTEX_GAP, and vertices
    closer than MIN_EDGE_GAP to an edge they aren't part of (including lying exactly on it)."""
    nodes = list(graph.nodes)
    if len(nodes) < 2:
        return 0
    index = {v: i for i, v in enumerate(nodes)}
    p = np.array([[pos[v][0] * size[0], pos[v][1] * size[1]] for v in nodes])
    dist = np.linalg.norm(p[:, None] - p[None], axis=-1)
    count = int((dist[np.triu_indices(len(nodes), 1)] < MIN_VERTEX_GAP).sum())
    edges = np.array([[index[u], index[v]] for u, v in graph.edges if u != v])
    if len(edges):
        gaps = _segment_distance(p[:, None], p[edges[:, 0]][None], p[edges[:, 1]][None])
        own = (edges[None, :, :] == np.arange(len(nodes))[:, None, None]).any(axis=2)
        count += int(((gaps < MIN_EDGE_GAP) & ~own).sum())
    return count


def badness(graph: nx.Graph, pos: dict, size: tuple[int, int] = DEFAULT_SIZE) -> int:
    """Crossings plus near-misses. A drawing where an edge passes through a vertex has no proper
    crossing, but it reads like one, so it must not count as better."""
    return count_crossings(graph, pos) + NEAR_MISS_COST * _violations(graph, pos, size)


class _CrossingSearch:
    """Local search for non-planar graphs: move one vertex at a time to the spot with the
    lowest badness (crossings of its edges plus near-misses with other vertices and edges),
    until no single move helps. Iterated: then shake a few vertices and search again,
    keeping the result only if it is better."""

    def __init__(self, graph: nx.Graph, size: tuple[int, int], seed: int):
        self.graph = graph
        self.size = size
        self.nodes = list(graph.nodes)
        self.index = {v: i for i, v in enumerate(self.nodes)}
        self.edges = np.array([[self.index[u], self.index[v]] for u, v in graph.edges if u != v])
        self.neighbours = [[self.index[w] for w in graph.neighbors(v) if w != v] for v in self.nodes]
        self.grid = np.array(
            [(x, y) for x in np.linspace(0, size[0], SEARCH_GRID[0]) for y in np.linspace(0, size[1], SEARCH_GRID[1])]
        )
        self.order = sorted(range(len(self.nodes)), key=lambda i: -len(self.neighbours[i]))
        self.rng = np.random.default_rng(seed)
        # Stress (Kamada-Kawai, Gansner et al.): every pair of vertices should be as far apart
        # as their graph distance times a unit length, weighted by 1 / distance^2. The unit is
        # chosen so the longest shortest path fits the shorter side of the drawing area.
        lengths = dict(nx.all_pairs_shortest_path_length(graph))
        n = len(self.nodes)
        hops = np.array([[lengths[u].get(v, n) for v in self.nodes] for u in self.nodes], dtype=float)
        unit = min(size) / max(1.0, hops.max())
        self.unit = unit
        self.target = hops * unit
        with np.errstate(divide="ignore"):
            self.weight = np.where(hops > 0, 1.0 / np.maximum(hops, 1e-12) ** 2, 0.0)

    def to_pixels(self, pos: dict) -> np.ndarray:
        return np.array([[pos[v][0] * self.size[0], pos[v][1] * self.size[1]] for v in self.nodes])

    def to_pos(self, p: np.ndarray) -> dict:
        return _normalize({v: (float(p[i][0]), float(p[i][1])) for v, i in self.index.items()}, self.size)

    def energy(self, p: np.ndarray) -> float:
        """How good the drawing looks, second priority after badness: stress (how well it shows
        the graph's distances) plus a vertex-edge term from Davidson-Harel that grows as a
        vertex gets close to an edge it isn't part of. Stress alone happily presses vertices
        against edges when crossings are fixed."""
        dist = np.linalg.norm(p[:, None] - p[None], axis=-1)
        stress = (self.weight * (dist - self.target) ** 2)[np.triu_indices(len(p), 1)].sum() / self.unit**2
        if not len(self.edges):
            return float(stress)
        gaps = _segment_distance(p[:, None], p[self.edges[:, 0]][None], p[self.edges[:, 1]][None])
        own = (self.edges[None, :, :] == np.arange(len(p))[:, None, None]).any(axis=2)
        crowding = ((CLEARANCE_GOAL / np.maximum(gaps, 1.0)) ** 2)[~own].sum()
        return float(stress + crowding)

    def _spot_batch_size(self, i: int) -> int:
        # Largest broadcasts are spots x degree x edges (crossings) and
        # spots x degree x vertices (near-misses and energy).
        per_spot = max(1, len(self.neighbours[i])) * max(1, len(self.edges), len(self.nodes))
        return max(1, SCORING_BATCH_ELEMENTS // per_spot)

    def spot_energy(self, p: np.ndarray, i: int, spots: np.ndarray) -> np.ndarray:
        """The terms of energy() involving vertex i, evaluated in memory-bounded batches."""
        result = np.empty(len(spots))
        batch_size = self._spot_batch_size(i)
        for start in range(0, len(spots), batch_size):
            end = start + batch_size
            result[start:end] = self._spot_energy_batch(p, i, spots[start:end])
        return result

    def _spot_energy_batch(self, p: np.ndarray, i: int, spots: np.ndarray) -> np.ndarray:
        dist = np.linalg.norm(spots[:, None] - p[None], axis=-1)  # (spots, all vertices)
        result = (self.weight[i][None] * (dist - self.target[i][None]) ** 2).sum(axis=1) / self.unit**2
        if not len(self.edges):
            return result
        # Vertex i near edges it isn't part of.
        not_mine = ~(self.edges == i).any(axis=1)
        if not_mine.any():
            a, b = p[self.edges[not_mine, 0]], p[self.edges[not_mine, 1]]
            gaps = _segment_distance(spots[:, None], a[None], b[None])
            result += ((CLEARANCE_GOAL / np.maximum(gaps, 1.0)) ** 2).sum(axis=1)
        # Other vertices near i's edges (except each edge's own far endpoint).
        nbrs = self.neighbours[i]
        if nbrs:
            others = np.array([j for j in range(len(self.nodes)) if j != i], dtype=int)
            gaps = _segment_distance(p[others][None, None], spots[:, None, None], p[nbrs][None, :, None])
            own_end = others[None, :] == np.array(nbrs)[:, None]
            result += (((CLEARANCE_GOAL / np.maximum(gaps, 1.0)) ** 2) * ~own_end[None]).sum(axis=(1, 2))
        return result

    def score(self, p: np.ndarray) -> int:
        pos = {v: (p[i][0] / self.size[0], p[i][1] / self.size[1]) for v, i in self.index.items()}
        return badness(self.graph, pos, self.size)

    def spot_scores(self, p: np.ndarray, i: int, spots: np.ndarray) -> np.ndarray:
        """Badness of vertex i's edges and surroundings if i were at each spot."""
        crossings, near = self.spot_terms(p, i, spots)
        return crossings + NEAR_MISS_COST * near

    def spot_terms(self, p: np.ndarray, i: int, spots: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Crossings and near-misses at each spot, evaluated in memory-bounded batches."""
        crossings, near = np.empty(len(spots)), np.empty(len(spots))
        batch_size = self._spot_batch_size(i)
        for start in range(0, len(spots), batch_size):
            end = start + batch_size
            crossings[start:end], near[start:end] = self._spot_terms_batch(p, i, spots[start:end])
        return crossings, near

    def _spot_terms_batch(self, p: np.ndarray, i: int, spots: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        nbrs = self.neighbours[i]
        edges = self.edges
        w = p[nbrs]
        a, b = p[edges[:, 0]], p[edges[:, 1]]

        # Crossings between each moved edge (spot, w_j) and each other edge k.
        touches = (edges[None, :, :] == np.array(nbrs)[:, None, None]).any(axis=2) | (edges == i).any(axis=1)[None, :]
        s1 = spots[:, None, None, :]
        s2 = w[None, :, None, :]
        d1 = _orient(a[None, None], b[None, None], s1)
        d2 = _orient(a[None, None], b[None, None], s2)
        d3 = _orient(s1, s2, a[None, None])
        d4 = _orient(s1, s2, b[None, None])
        crossings = ((d1 * d2 < 0) & (d3 * d4 < 0) & ~touches[None]).sum(axis=(1, 2)).astype(float)

        # Near-misses: the vertex too close to other vertices or to edges it isn't part of,
        # and other vertices too close to its edges.
        # These must be exactly the terms of badness() that change when i moves; skipping
        # any of them lets the search go round in circles.
        near = np.zeros(len(spots))
        others = np.array([j for j in range(len(self.nodes)) if j != i], dtype=int)
        if len(others):
            near += (np.linalg.norm(spots[:, None] - p[others][None], axis=-1) < MIN_VERTEX_GAP).sum(axis=1)
            # Every vertex except the edge's own endpoints counts, neighbours of i included.
            gaps = _segment_distance(p[others][None, None], spots[:, None, None], w[None, :, None])
            own_end = others[None, :] == np.array(nbrs)[:, None]  # (edge j, vertex) pairs to skip
            near += ((gaps < MIN_EDGE_GAP) & ~own_end[None]).sum(axis=(1, 2))
        not_mine = ~(edges == i).any(axis=1)
        if not_mine.any():
            gaps = _segment_distance(spots[:, None], a[not_mine][None], b[not_mine][None])
            near += (gaps < MIN_EDGE_GAP).sum(axis=1)
        return crossings, near

    def improve(self, p: np.ndarray, deadline: float, polish: bool = False) -> None:
        """Move single vertices while that lowers the badness. With polish, also move between
        spots of equal badness when that lowers the stress. Changes p in place."""
        improved = True
        while improved and time.monotonic() < deadline:
            improved = False
            for i in self.order:
                if time.monotonic() > deadline:
                    break
                nbrs = self.neighbours[i]
                if not nbrs:
                    continue
                spots = np.vstack([p[i], p[nbrs].mean(axis=0), self.grid])  # spot 0 = stay
                scores = self.spot_scores(p, i, spots)
                if polish:
                    # Never worse on badness; among equally good spots, the lowest stress. The
                    # stress must drop by a margin, so the loop ends.
                    energy = self.spot_energy(p, i, spots)
                    tied = np.flatnonzero(scores == scores[0])
                    best = int(tied[np.argmin(energy[tied])])
                    better = scores.min() < scores[0] or energy[best] < energy[0] - ENERGY_MARGIN
                    if scores.min() < scores[0]:
                        best = int(np.argmin(scores))
                else:
                    best = int(np.argmin(scores))  # ties keep the earliest spot, i.e. staying put
                    better = scores[best] < scores[0]
                if better:
                    p[i] = spots[best]
                    improved = True

    def relax(self, p: np.ndarray, deadline: float) -> None:
        """Polish without losing ground: stress majorization (Gansner et al.), one vertex at a
        time, keeping a move only if it adds neither crossings nor near-misses. Without this,
        any drawing with the minimum crossings counts as equally good. Changes p in place."""
        for _ in range(RELAX_STEPS):
            if time.monotonic() > deadline:
                break
            moved = False
            for i in self.order:
                diff = p[i] - p
                dist = np.maximum(np.linalg.norm(diff, axis=1), 1e-6)
                w = self.weight[i]
                # Each other vertex j "votes" for the spot at the target distance from it,
                # in the current direction; the weighted average is the new position.
                votes = p + (self.target[i] / dist)[:, None] * diff
                target = np.clip((w[:, None] * votes).sum(axis=0) / w.sum(), 0, self.size)
                if np.linalg.norm(target - p[i]) < 0.5:
                    continue
                spots = np.vstack([p[i], target])
                crossings, near = self.spot_terms(p, i, spots)
                if crossings[1] <= crossings[0] and near[1] <= near[0]:
                    stress = self.spot_energy(p, i, spots)
                    if stress[1] < stress[0]:
                        p[i] = target
                        moved = True
            if not moved:
                break

    def run(self, starts: list[dict], deadline: float, polish_seconds: float) -> dict:
        """Phase 1 minimizes badness (crossings, near-misses) with iterated local search.
        Phase 2 lowers the stress without letting badness grow."""
        best_p, best_score = None, math.inf
        for pos in starts:
            p = self.to_pixels(pos)
            self.improve(p, deadline)
            score = self.score(p)
            if score < best_score:
                best_p, best_score = p, score
        failures = 0
        while best_score > 0 and failures < SHAKE_ROUNDS and time.monotonic() < deadline:
            p = best_p.copy()
            shaken = self.rng.choice(len(self.nodes), size=min(SHAKE_VERTICES, len(self.nodes)), replace=False)
            p[shaken] = self.grid[self.rng.choice(len(self.grid), size=len(shaken))]
            self.improve(p, deadline)
            score = self.score(p)
            if score < best_score:
                best_p, best_score, failures = p, score, 0
            else:
                failures += 1

        polish_deadline = time.monotonic() + polish_seconds
        self.improve(best_p, polish_deadline, polish=True)
        self.relax(best_p, polish_deadline)
        return self.to_pos(best_p)

def _layout_component(graph: nx.Graph, seed: int, size: tuple[int, int]) -> dict:
    if graph.number_of_nodes() == 1:
        return {next(iter(graph.nodes)): (0.5, 0.5)}
    planar = is_planar(graph)
    if graph.number_of_edges() > MAX_EDGES_FOR_SEARCH:
        pos = nx.planar_layout(graph) if planar else nx.spring_layout(graph, seed=seed, weight=None)
        return _normalize({v: (float(x), float(y)) for v, (x, y) in pos.items()}, size)

    candidates = _candidates(graph, seed, size)
    if planar:
        # Planarity is mandatory, even when a crossing layout has fewer near-misses.
        # _candidates always includes NetworkX's crossing-free planar layout.
        candidates = [pos for pos in candidates if count_crossings(graph, pos) == 0]
    else:
        # Planarization: draw a large planar part without crossings, then add the rest.
        subgraph = _planar_subgraph(graph)
        candidates.append(_layout_component(subgraph, seed, size))
        # A crossing layout of that part may still be a better start for the full,
        # non-planar graph. Rank its alternatives against the full graph too.
        candidates.extend(_candidates(subgraph, seed, size))

    # Fewest crossings and near-misses first, then the most space between vertices.
    scored = [
        (-badness(graph, pos, size), clearance(graph, pos, size), i, pos)
        for i, pos in enumerate(candidates)
    ]
    scored.sort(key=lambda item: item[:3], reverse=True)
    neg_badness, space, _, best = scored[0]
    if not planar and neg_badness < 0:
        starts = [pos for *_, pos in scored[:SEARCH_STARTS]]
        best = _CrossingSearch(graph, size, seed).run(starts, time.monotonic() + SEARCH_SECONDS, POLISH_SECONDS)
    elif count_crossings(graph, best) == 0 and space < GOOD_CLEARANCE:
        refined = _refine(graph, best, size)
        if clearance(graph, refined, size) > space:
            best = refined
    return best


def initial_layout(graph: nx.Graph, seed: int = 0, size: tuple[int, int] = DEFAULT_SIZE) -> dict[object, Point]:
    """Positions in [0, 1] x [0, 1]. Planar graphs get a crossing-free layout.

    Connected components are laid out separately, using multiple rows when needed.
    """
    components = sorted(nx.connected_components(graph), key=len, reverse=True)
    if not components:
        return {}
    count = len(components)
    # Keep small graphs side by side; otherwise aim for square slots in pixels.
    columns = count if count <= 3 else min(count - 1, max(1, math.ceil(math.sqrt(count * size[0] / size[1]))))
    rows = math.ceil(count / columns)
    # Reserve at most 20% of either axis for gaps, even with many components.
    gap_x, gap_y = min(0.04, 0.2 / columns), min(0.04, 0.2 / rows)
    height = (1 - gap_y * (rows - 1)) / rows
    pos = {}
    for row in range(rows):
        group = components[row * columns:(row + 1) * columns]
        total = sum(len(c) for c in group)
        usable = 1 - gap_x * (len(group) - 1)
        top = row * (height + gap_y)
        bottom = 1.0 if row == rows - 1 else top + height
        left = 0.0
        for column, component in enumerate(group):
            # Pin the last boundary to 1 to avoid accumulated rounding overflow.
            right = 1.0 if column == len(group) - 1 else left + usable * len(component) / total
            width, row_height = right - left, bottom - top
            sub_size = (max(1, int(size[0] * width)), max(1, int(size[1] * row_height)))
            sub = _layout_component(graph.subgraph(component), seed, sub_size)
            for v, (x, y) in sub.items():
                pos[v] = (left + x * width, top + y * row_height)
            left = right + gap_x
    return pos
