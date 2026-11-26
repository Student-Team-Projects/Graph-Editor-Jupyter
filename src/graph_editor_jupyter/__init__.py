import networkx as nx
from IPython.display import display

from .widget import GraphWidget

__all__ = ["GraphWidget", "edit"]


def edit(graph: nx.Graph) -> None:
    """Show `graph` in an interactive editor below the current notebook cell.

    Attributes set the look: ``label``, ``color``, ``size`` of a vertex; ``weight`` (or
    ``label``), ``color``, ``width`` of an edge. An nx.DiGraph is drawn with arrows."""
    display(GraphWidget(graph))
