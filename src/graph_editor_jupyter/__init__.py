import networkx as nx
from IPython.display import display

from .widget import GraphWidget

__all__ = ["GraphWidget", "edit"]


def edit(graph: nx.Graph) -> None:
    """Show `graph` in an interactive editor below the current notebook cell."""
    display(GraphWidget(graph))
