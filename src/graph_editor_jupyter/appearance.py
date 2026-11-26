"""How vertices and edges look: read from NetworkX attributes (docs/requirements.md, "Labels").

The attribute names follow NetworkX and nx.draw where they can, so graphs drawn with nx.draw
need no changes:

- vertex: ``label`` (shown instead of the node's name), ``color`` (fill), ``size`` (diameter
  in pixels);
- edge: ``weight`` (shown on the edge), ``label`` (shown instead of the weight), ``color``,
  ``width`` (in pixels);
- a directed graph (nx.DiGraph) gets arrows.

A value that can't be used (a size that isn't a positive number, say) is left out, and the
default look is used instead of raising: a graph built for another tool still opens.
"""

from numbers import Real

MIN_SIZE, MAX_SIZE = 8, 200  # vertex diameter in pixels; the label still fits (widget.ts)
MIN_WIDTH, MAX_WIDTH = 0.5, 20  # edge width in pixels


def node_view(node, attrs: dict) -> dict:
    """The label, and the color and size if given, of one vertex."""
    view = {"label": str(attrs["label"]) if attrs.get("label") is not None else str(node)}
    color = css_color(attrs.get("color"))
    if color is not None:
        view["color"] = color
    size = _number(attrs.get("size"))
    if size is not None and size > 0:
        view["size"] = min(max(size, MIN_SIZE), MAX_SIZE)
    return view


def edge_view(attrs: dict) -> dict:
    """The label (its ``label``, else its ``weight``), color and width of one edge, if given."""
    view = {}
    text = attrs.get("label", attrs.get("weight"))
    if text is not None:
        view["label"] = _format(text)
    color = css_color(attrs.get("color"))
    if color is not None:
        view["color"] = color
    width = _number(attrs.get("width"))
    if width is not None and width > 0:
        view["width"] = min(max(width, MIN_WIDTH), MAX_WIDTH)
    return view


def css_color(value) -> str | None:
    """A CSS color for ``value``: a string as it is ("red", "#1f77b4", "rgb(0, 0, 255)"), or an
    RGB(A) tuple, either in 0..1 as in matplotlib or in 0..255 if any part is above 1. The front
    end drops strings the browser doesn't know as colors."""
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, (tuple, list)) and len(value) in (3, 4) and all(_number(c) is not None for c in value):
        rgb = [float(c) for c in value[:3]]
        scale = 1 if any(c > 1 for c in rgb) else 255
        r, g, b = (round(min(max(c * scale, 0), 255)) for c in rgb)
        if len(value) == 4:
            alpha = min(max(float(value[3]), 0), 1)
            return f"rgba({r}, {g}, {b}, {alpha:g})"
        return f"rgb({r}, {g}, {b})"
    return None


def _number(value) -> float | None:
    # bool is a Real in Python, but size=True is a mistake, not a size of 1.
    if isinstance(value, bool) or not isinstance(value, Real):
        return None
    value = float(value)
    return value if value == value and abs(value) != float("inf") else None


def _format(value) -> str:
    """A weight as people write it: 3, 2.5, 0.3 (not 0.30000000000000004)."""
    if isinstance(value, float) and not isinstance(value, bool):
        return f"{value:.6g}"
    return str(value)
