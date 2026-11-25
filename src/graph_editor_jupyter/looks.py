"""Arrange for looks: symmetric, even drawings, even when edges cross more often than they must.

The first layout and the default Arrange put fewest crossings first (docs/requirements.md). This
is the other choice in the Arrange menu (decided 2026-11-23, docs/research/08-layout-for-looks.md).

Candidates for each connected component:
- Drawings that show a rotational symmetry of the graph. An automorphism whose cycles all have
  the same length k >= 3 (one vertex may stay put, in the middle) is drawn as rings: each cycle
  on a circle, each step of the automorphism turning the drawing by 360/k degrees. Ring radii
  and turns are chosen to minimise stress; variants turn the rings against each other by
  multiples of 180/k degrees, which also gives mirror symmetry where the graph has it. One cycle
  through every vertex gives a circle, as for circulant graphs; the Petersen graph gets a
  pentagon around a pentagram.
- A circle with the vertices in their given order (graphs built as circulants or from LCF
  notation come numbered around a cycle), and one with the order chosen to cut crossings.
- Kamada-Kawai (stress); for planar graphs, the crossing-free first layout and Tutte's drawing.
Planar graphs only get crossing-free candidates, as in the first layout. Trees keep the layered
drawing of the first layout. The best candidate by `looks_score` wins; the symmetry it rewards
is measured on the drawing itself (rotations and mirror images that map the drawing onto
itself), so every candidate is judged the same way.

Positions are normalized to [0, 1] x [0, 1], like layout.initial_layout.
"""

import math
import time
from itertools import islice, product

import networkx as nx
import numpy as np
from scipy.optimize import minimize

from .layout import (
    DEFAULT_SIZE,
    _layout_component,
    _normalize,
    _violations,
    is_planar,
    pack_components,
    tutte_layout,
)

Point = tuple[float, float]

LOOKS_SECONDS = 3.0  # time budget for the ring drawings of one component; past it, no more are tried
SYMMETRY_SECONDS = 0.4  # time budget for looking for automorphisms of one component
CIRCLE_SECONDS = 0.4  # time budget for improving the vertex order on the circle
MAX_NODES = 120  # above this, no symmetry search and no Kamada-Kawai: both get slow
RING_STARTS = 6  # random starts when fitting ring radii and turns
MAX_RINGS_PER_ORDER = 2  # automorphisms tried for each symmetry order
MAX_ORDERS = 4  # symmetry orders tried, largest first
MAX_RINGS = 12  # automorphisms needing more rings than this don't show their symmetry plainly
MAX_TURNS = 24  # combinations of ring turns (multiples of 180/k degrees) tried per ring drawing
RING_VARIANTS = MAX_TURNS + 1  # ring drawings kept per automorphism (all: the most symmetric often has more stress)
# While fitting rings, vertices closer than this (in edge lengths) are pushed apart: stress alone
# squeezed the inner ring of the dodecahedron until its vertices touched.
MIN_SPACING = 0.6
CRAMP_COST = 10.0
SPREAD_POWERS = (0.8, 0.65, 0.5)  # see _spread
UPRIGHT_TOLERANCE = math.radians(1.5)  # an edge this close to level or upright counts as such
SYMMETRY_TOLERANCE = 0.015  # share of the drawing's size two points may differ by and still match
# Looks score weights, see looks_score. Calibrated on the demo graphs and a few well-known ones
# (docs/research/08-layout-for-looks.md).
CROSSING_WEIGHT = 1.0
SYMMETRY_WEIGHT = 1.0
EVENNESS_WEIGHT = 1.0
ANGLE_WEIGHT = 1.0
NEAR_MISS_WEIGHT = 2.0


def looks_layout(graph: nx.Graph, seed: int = 0, size: tuple[int, int] = DEFAULT_SIZE) -> dict[object, Point]:
    """Positions in [0, 1] x [0, 1] that go for looks; see the module docstring."""
    return pack_components(graph, size, lambda component, sub_size: _looks_component(component, seed, sub_size))


def looks_score(graph: nx.Graph, pos: dict, fewest: int, size: tuple[int, int]) -> float:
    """Lower is better. Rewards the symmetry the drawing shows (shown_symmetry); charges
    crossings beyond the fewest any candidate has (on a log scale: going from 200 to 1000
    crossings in a dense graph matters less than from 0 to 5), uneven edge lengths, edges
    leaving a vertex close together instead of spread around it (of two equally symmetric
    drawings of the Moebius-Kantor graph it picks the one with spokes straight out from the
    middle), and near-misses (vertices on top of each other or on an edge), which make a drawing
    unreadable."""
    crossings = _crossings(graph, pos)
    symmetry = shown_symmetry(graph, pos, size)
    lengths = np.array([math.dist(pos[u], pos[v]) for u, v in graph.edges if u != v] or [1.0])
    unevenness = float(lengths.std() / lengths.mean()) if lengths.mean() > 0 else 0.0
    return (
        CROSSING_WEIGHT * (math.log1p(crossings) - math.log1p(fewest))
        - SYMMETRY_WEIGHT * math.log(symmetry)
        + EVENNESS_WEIGHT * unevenness
        + ANGLE_WEIGHT * _crowded_angles(graph, pos)
        + NEAR_MISS_WEIGHT * math.log1p(_violations(graph, pos, size))
    )


def _looks_component(graph: nx.Graph, seed: int, size: tuple[int, int]) -> dict:
    n = graph.number_of_nodes()
    if n < 3 or nx.is_tree(graph):
        return _layout_component(graph, seed, size)
    simple = nx.Graph(graph)
    simple.remove_edges_from(nx.selfloop_edges(simple))
    candidates: list[dict] = []
    if n <= MAX_NODES:
        distances = _distances(simple)
        deadline = time.monotonic() + LOOKS_SECONDS
        for k, cycles, centre in _rotations(simple, time.monotonic() + SYMMETRY_SECONDS):
            if time.monotonic() > deadline:
                break
            candidates.extend(_rings(cycles, centre, k, distances, seed))
        candidates.append(nx.kamada_kawai_layout(simple, weight=None))
    candidates.append(_circle_in_order(list(simple.nodes)))
    candidates.append(_circle(simple, seed, time.monotonic() + CIRCLE_SECONDS))
    planar = is_planar(simple)
    if planar:
        candidates.append(_layout_component(simple, seed, size))
        if n >= 4 and nx.node_connectivity(simple) >= 3:
            candidates.extend(_spread(tutte_layout(simple)))

    scored = []
    for pos in candidates:
        pos = _normalize({v: (float(x), float(y)) for v, (x, y) in pos.items()}, size)
        scored.append((pos, _crossings(simple, pos)))
    if planar:
        # As in the first layout, a planar graph is never drawn with crossings.
        scored = [item for item in scored if item[1] == 0] or scored
    fewest = min(c for _, c in scored)
    best = min(scored, key=lambda item: looks_score(simple, item[0], fewest, size))[0]
    if shown_symmetry(simple, best, size) >= 3:
        # A round, symmetric drawing came out at whatever angle the fit left it: stand it up.
        best = _normalize(_upright(simple, {v: (x * size[0], y * size[1]) for v, (x, y) in best.items()}), size)
    return best


def _upright(graph: nx.Graph, pos: dict) -> dict:
    """The drawing turned about its centre so that as many edges as possible run level or
    upright (a grid comes out square, not as a diamond); if that is no help, so that a vertex
    points straight up."""
    nodes = list(pos)
    p = np.array([pos[v] for v in nodes], dtype=float)
    centre = p.mean(axis=0)
    q = p - centre
    index = {v: i for i, v in enumerate(nodes)}
    edges = np.array([[index[u], index[v]] for u, v in graph.edges if u != v]).reshape(-1, 2)
    directions = np.arctan2(*(q[edges[:, 1]] - q[edges[:, 0]]).T[::-1]) if len(edges) else np.array([])
    far = int(np.linalg.norm(q, axis=1).argmax())
    top = -math.pi / 2 - math.atan2(q[far, 1], q[far, 0])  # turn that puts the farthest vertex on top
    turns = [top] + [-a for a in directions]

    def level(turn: float) -> int:
        tilt = np.mod(directions + turn, math.pi / 2)
        return int(((tilt < UPRIGHT_TOLERANCE) | (tilt > math.pi / 2 - UPRIGHT_TOLERANCE)).sum())

    best = max(turns, key=lambda turn: (level(turn), turn == top))
    c, s_ = math.cos(best), math.sin(best)
    turned = q @ np.array([[c, s_], [-s_, c]])
    return {v: (float(x), float(y)) for v, (x, y) in zip(nodes, turned + centre)}


def _crossings(graph: nx.Graph, pos: dict) -> int:
    """count_crossings, with numpy: the same pairs, much faster on the many candidates."""
    edges = [(u, v) for u, v in graph.edges if u != v]
    if len(edges) < 2:
        return 0
    nodes = list(graph.nodes)
    index = {v: i for i, v in enumerate(nodes)}
    p = np.array([pos[v] for v in nodes], dtype=float)
    e = np.array([[index[u], index[v]] for u, v in edges])
    a, b = p[e[:, 0]], p[e[:, 1]]

    def orient(x, y, z):
        return (y[..., 0] - x[..., 0]) * (z[..., 1] - x[..., 1]) - (y[..., 1] - x[..., 1]) * (z[..., 0] - x[..., 0])

    a1, b1, a2, b2 = a[:, None], b[:, None], a[None, :], b[None, :]
    cross = (orient(a2, b2, a1) * orient(a2, b2, b1) < 0) & (orient(a1, b1, a2) * orient(a1, b1, b2) < 0)
    shared = (e[:, None, :, None] == e[None, :, None, :]).any(axis=(2, 3))
    return int((cross & ~shared).sum() // 2)


def _crowded_angles(graph: nx.Graph, pos: dict) -> float:
    """Average over vertices with two or more edges of how far the smallest angle between two
    of their edges falls short of an even spread (360 degrees / degree): 0 when evenly spread,
    near 1 when two edges almost overlap."""
    shortfalls = []
    for v in graph.nodes:
        others = [w for w in graph.neighbors(v) if w != v]
        if len(others) < 2:
            continue
        angles = sorted(math.atan2(pos[w][1] - pos[v][1], pos[w][0] - pos[v][0]) for w in others)
        gaps = [b - a for a, b in zip(angles, angles[1:])] + [angles[0] + 2 * math.pi - angles[-1]]
        even = 2 * math.pi / len(others)
        shortfalls.append(max(0.0, 1 - min(gaps) / even))
    return float(np.mean(shortfalls)) if shortfalls else 0.0


def shown_symmetry(graph: nx.Graph, pos: dict, size: tuple[int, int] = DEFAULT_SIZE) -> int:
    """How many rotations and mirror images (about the drawing's centre of mass) map the drawing
    onto itself, vertices onto vertices and edges onto edges: 1 for none, 10 for the Petersen
    graph as a pentagon around a pentagram (5 rotations, 5 mirror images)."""
    nodes = list(graph.nodes)
    n = len(nodes)
    if n < 2:
        return 1
    index = {v: i for i, v in enumerate(nodes)}
    p = np.array([[pos[v][0] * size[0], pos[v][1] * size[1]] for v in nodes])
    q = p - p.mean(axis=0)
    reach = float(np.linalg.norm(q, axis=1).max())
    if reach < 1e-9:
        return 1
    tolerance = SYMMETRY_TOLERANCE * reach
    edges = {frozenset((index[u], index[v])) for u, v in graph.edges if u != v}

    def maps_onto_itself(matrix: np.ndarray) -> bool:
        moved = q @ matrix.T
        gaps = np.linalg.norm(moved[:, None] - q[None], axis=-1)
        image = gaps.argmin(axis=1)
        if gaps[np.arange(n), image].max() > tolerance or len(set(image.tolist())) < n:
            return False
        return all(frozenset((image[a], image[b])) in edges for a, b in map(tuple, edges))

    def rotation(angle: float) -> np.ndarray:
        return np.array([[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]])

    # A rotation by 360/j degrees moves vertices in cycles of j, except one in the middle.
    orders = [j for j in range(2, n + 1) if n % j == 0 or (n - 1) % j == 0]
    turns = max((j for j in orders if maps_onto_itself(rotation(2 * math.pi / j))), default=1)
    # A mirror line through the centre maps the farthest vertex onto a vertex as far out: try the
    # line halfway between it and each of those.
    far = int(np.linalg.norm(q, axis=1).argmax())
    start = math.atan2(q[far, 1], q[far, 0])
    mirrored = False
    for other in range(n):
        if abs(np.linalg.norm(q[other]) - reach) > tolerance:
            continue
        axis = (start + math.atan2(q[other, 1], q[other, 0])) / 2
        reflection = np.array([[math.cos(2 * axis), math.sin(2 * axis)], [math.sin(2 * axis), -math.cos(2 * axis)]])
        if maps_onto_itself(reflection):
            mirrored = True
            break
    return turns * (2 if mirrored else 1)


def _distances(graph: nx.Graph) -> dict:
    return dict(nx.all_pairs_shortest_path_length(graph))


# ---- rotational symmetry ----


def _cycles(perm: dict) -> list[list]:
    seen, cycles = set(), []
    for v in perm:
        if v in seen:
            continue
        cycle = [v]
        seen.add(v)
        w = perm[v]
        while w != v:
            cycle.append(w)
            seen.add(w)
            w = perm[w]
        cycles.append(cycle)
    return cycles


def _rotation(perm: dict):
    """(k, cycles, centre) if the automorphism can be drawn as a rotation: every cycle of
    length k >= 3 except at most one fixed vertex, which goes in the middle. Otherwise None."""
    cycles = _cycles(perm)
    fixed = [c[0] for c in cycles if len(c) == 1]
    moving = [c for c in cycles if len(c) > 1]
    if len(fixed) > 1 or not moving:
        return None
    k = len(moving[0])
    if k < 3 or any(len(c) != k for c in moving):
        return None
    return k, moving, fixed[0] if fixed else None


def _automorphisms(graph: nx.Graph, deadline: float):
    """Automorphisms of the graph: first shifts of the vertex order (cheap, and they catch
    circulant graphs and graphs built from LCF notation at once), then as many as VF2 finds
    before the deadline."""
    nodes = list(graph.nodes)
    n = len(nodes)
    edges = {frozenset(e) for e in graph.edges}
    for shift in range(1, n):
        perm = {nodes[i]: nodes[(i + shift) % n] for i in range(n)}
        if all(frozenset((perm[u], perm[v])) in edges for u, v in graph.edges):
            yield perm
    matcher = nx.algorithms.isomorphism.GraphMatcher(graph, graph)
    for perm in matcher.isomorphisms_iter():
        if time.monotonic() > deadline:
            return
        yield perm


def _rotations(graph: nx.Graph, deadline: float) -> list[tuple[int, list[list], object]]:
    """Distinct ways to draw the graph with rotational symmetry, highest order first."""
    index = {v: i for i, v in enumerate(graph.nodes)}

    def key(cycles):
        # The same drawing, mirrored, comes from the inverse automorphism.
        def canon(cs):
            out = []
            for c in cs:
                start = min(range(len(c)), key=lambda i: index[c[i]])
                out.append(tuple(c[start:] + c[:start]))
            return frozenset(out)

        return min(canon(cycles), canon([c[::-1] for c in cycles]), key=lambda f: sorted(f))

    found: dict[int, dict] = {}
    for perm in _automorphisms(graph, deadline):
        shape = _rotation(perm)
        if shape is None or len(shape[1]) > MAX_RINGS:
            continue
        k, cycles, centre = shape
        # Powers coprime to k give the same rings in a different order around each: another drawing.
        for j in range(1, k):
            if math.gcd(j, k) != 1:
                continue
            powered = [[c[(t * j) % k] for t in range(k)] for c in cycles]
            found.setdefault(k, {}).setdefault(key(powered), (k, powered, centre))
        if time.monotonic() > deadline:
            break
    def along(cycles):
        # Edges between neighbours on a ring: they draw polygons, the plainest way to show it.
        return sum(graph.has_edge(c[t], c[(t + 1) % len(c)]) for c in cycles for t in range(len(c)))

    rotations = []
    for k in sorted(found, reverse=True)[:MAX_ORDERS]:
        # Fewer rings first, then more edges along the rings: they show the symmetry most plainly.
        variants = sorted(found[k].values(), key=lambda item: (len(item[1]), -along(item[1])))
        rotations.extend(variants[:MAX_RINGS_PER_ORDER])
    return rotations


def _ring_model(cycles: list[list], centre, k: int, distances: dict):
    """For ring drawings of one automorphism: the vertices in drawing order, a function placing
    them for given radii and turns, a function returning the stress and its gradient with
    respect to the radii and the turns, and the largest graph distance."""
    nodes = [v for c in cycles for v in c] + ([centre] if centre is not None else [])
    ring = np.array([i for i, c in enumerate(cycles) for _ in c] + ([-1] if centre is not None else []))
    step = np.array([t for c in cycles for t in range(len(c))] + ([0] if centre is not None else []))
    target = np.array([[distances[u].get(v, 0) for v in nodes] for u in nodes], dtype=float)
    upper = np.triu_indices(len(nodes), 1)
    d = target[upper]
    weight = 1.0 / np.maximum(d, 1.0) ** 2
    rings = len(cycles)

    def angles(turns):
        return np.append(turns, 0.0)[ring] + 2 * np.pi * step / k

    def place(radii, turns):
        radius = np.append(radii, 0.0)[ring]
        angle = angles(turns)
        return np.stack([radius * np.cos(angle), radius * np.sin(angle)], axis=1)

    def stress(radii, turns):
        radius = np.append(radii, 0.0)[ring]
        angle = angles(turns)
        p = np.stack([radius * np.cos(angle), radius * np.sin(angle)], axis=1)
        diff = p[upper[0]] - p[upper[1]]
        drawn = np.maximum(np.linalg.norm(diff, axis=1), 1e-9)
        cramped = np.maximum(0.0, MIN_SPACING - drawn)
        value = float((weight * (drawn - d) ** 2).sum() + CRAMP_COST * (cramped**2).sum())
        pull = (2 * weight * (drawn - d) - 2 * CRAMP_COST * cramped) / drawn
        force = pull[:, None] * diff
        grad_p = np.zeros_like(p)
        np.add.at(grad_p, upper[0], force)
        np.add.at(grad_p, upper[1], -force)
        along = grad_p[:, 0] * np.cos(angle) + grad_p[:, 1] * np.sin(angle)
        around = radius * (-grad_p[:, 0] * np.sin(angle) + grad_p[:, 1] * np.cos(angle))
        moving = ring >= 0  # the vertex in the middle has no radius or turn
        grad_r = np.bincount(ring[moving], weights=along[moving], minlength=rings)
        grad_t = np.bincount(ring[moving], weights=around[moving], minlength=rings)
        return value, grad_r, grad_t

    return nodes, place, stress, float(d.max()) if len(d) else 1.0


def _rings(cycles: list[list], centre, k: int, distances: dict, seed: int) -> list[dict]:
    """Ring drawings of one automorphism: each cycle on a circle, step t of the rotation at angle
    turn + 2 pi t / k. The best fit of radii and turns to the graph distances (stress), and
    variants with the turns set to multiples of pi / k apart (radii fitted again), best first."""
    nodes, place, stress, farthest = _ring_model(cycles, centre, k, distances)
    rings = len(cycles)
    rng = np.random.default_rng(seed)
    scale = max(1.0, farthest)
    radius_bounds = [(0.05, 2 * scale)] * rings

    def both(x):
        value, grad_r, grad_t = stress(x[:rings], x[rings:])
        return value, np.concatenate([grad_r, grad_t])

    best = None
    for _ in range(RING_STARTS):
        x0 = np.concatenate([rng.uniform(0.3, 1.0, rings) * scale, rng.uniform(0, 2 * np.pi / k, rings)])
        result = minimize(both, x0, jac=True, method="L-BFGS-B", bounds=radius_bounds + [(None, None)] * rings)
        if best is None or result.fun < best.fun:
            best = result
    fits = [(best.fun, best.x[:rings], best.x[rings:])]
    if rings > 1:
        half_step = np.pi / k
        first = best.x[rings]
        nearest = np.round((best.x[rings + 1:] - first) / half_step).astype(int)
        if (2 * k) ** (rings - 1) <= MAX_TURNS:
            choices = product(range(2 * k), repeat=rings - 1)
        else:
            choices = islice(product(*[(m - 1, m, m + 1) for m in nearest]), MAX_TURNS)
        for multiples in choices:
            turns = np.concatenate([[first], first + half_step * np.array(multiples)])
            result = minimize(
                lambda r: stress(r, turns)[:2], best.x[:rings], jac=True, method="L-BFGS-B", bounds=radius_bounds
            )
            fits.append((result.fun, result.x, turns))
    fits.sort(key=lambda fit: fit[0])
    drawings = []
    for _, radii, turns in fits[:RING_VARIANTS]:
        p = place(radii, turns)
        drawings.append({v: (float(p[i, 0]), float(p[i, 1])) for i, v in enumerate(nodes)})
    return drawings


def _spread(pos: dict) -> list[dict]:
    """The drawing as it is, and pulled out from its middle (each vertex's distance r from the
    centre made r ** power). Tutte's drawing crowds the inner faces; this spreads them and keeps
    the symmetry. Variants that gain a crossing are dropped later, with all candidates."""
    p = np.array(list(pos.values()), dtype=float)
    q = p - p.mean(axis=0)
    r = np.linalg.norm(q, axis=1)
    reach = float(r.max()) or 1.0
    drawings = [pos]
    for power in SPREAD_POWERS:
        factor = np.ones_like(r)
        np.power(r / reach, power - 1, out=factor, where=r > 1e-12)  # a vertex in the middle stays there
        scaled = q * factor[:, None]
        drawings.append({v: (float(x), float(y)) for v, (x, y) in zip(pos, scaled)})
    return drawings


def _circle_in_order(nodes: list) -> dict:
    n = len(nodes)
    return {v: (math.cos(2 * math.pi * i / n), math.sin(2 * math.pi * i / n)) for i, v in enumerate(nodes)}


# ---- circle with a good vertex order ----


def _circle_crossings(rank: np.ndarray, edges: np.ndarray) -> int:
    """Crossings of chords on a circle with vertices in order `rank`: two chords cross exactly
    when their ends alternate around the circle."""
    a = np.minimum(rank[edges[:, 0]], rank[edges[:, 1]])
    b = np.maximum(rank[edges[:, 0]], rank[edges[:, 1]])
    a1, a2 = a[:, None], a[None, :]
    b1, b2 = b[:, None], b[None, :]
    cross = ((a1 < a2) & (a2 < b1) & (b1 < b2)) | ((a2 < a1) & (a1 < b2) & (b2 < b1))
    return int(cross.sum() // 2)


def _circle(graph: nx.Graph, seed: int, deadline: float) -> dict:
    """Vertices evenly on a circle, in an order with few crossings: by the angle of each vertex
    in the plane of the Laplacian's second and third eigenvectors (neighbours get close angles),
    then moving single vertices while that removes crossings."""
    nodes = list(graph.nodes)
    n = len(nodes)
    index = {v: i for i, v in enumerate(nodes)}
    edges = np.array([[index[u], index[v]] for u, v in graph.edges], dtype=int).reshape(-1, 2)
    laplacian = nx.laplacian_matrix(graph, nodelist=nodes).toarray().astype(float)
    _, vectors = np.linalg.eigh(laplacian)
    if n >= 3:
        angles = np.arctan2(vectors[:, 2], vectors[:, 1])
        order = list(np.argsort(angles, kind="stable"))
    else:
        order = list(range(n))
    rank = np.empty(n, dtype=int)
    rank[order] = np.arange(n)
    best = _circle_crossings(rank, edges)
    improved = True
    while improved and time.monotonic() < deadline:
        improved = False
        for v in range(n):
            if time.monotonic() > deadline:
                break
            rest = [w for w in order if w != v]
            for place in range(n):
                trial = rest[:place] + [v] + rest[place:]
                trial_rank = np.empty(n, dtype=int)
                trial_rank[trial] = np.arange(n)
                crossings = _circle_crossings(trial_rank, edges)
                if crossings < best:
                    best, order, rank, improved = crossings, trial, trial_rank, True
    return {
        nodes[i]: (math.cos(2 * math.pi * rank[i] / n), math.sin(2 * math.pi * rank[i] / n))
        for i in range(n)
    }

