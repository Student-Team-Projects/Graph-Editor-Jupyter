## Interactive Graph Editor for Jupyter

An interactive graph editor function designed for Jupyter notebooks. ```edit(graph: nx.Graph)``` function allows users <br>
to manipulate a graph by creating vertices, edges, and adding labels directly within a Jupyter environment.

### Parameters
- **graph** (*networkx.Graph*): The graph object to be edited.
  It should be an instance of the NetworkX Graph class or a subclass.

### Functions of buttons (from left to right)
1. Select whether you want to edit graph structure.
2. Select if you want to edit labels
3. Select if you want for nodes to be clickable.
    Deselecting this should make easier to operate on edges in a large graph.
4. Select if you want for edges to be clickable.
    Deselecting this should make easier to operate on nodes in a large graph.
5. Turn on/off physics.
6. Turn on/off fancy drawing (planar representation of a graph, works only for 3-connected planar graphs).
7. Enable/disable labels.
8. Exit the editor.

### Mouse Functions
1. Click and drag vertices to move them around the canvas.
2. To create an edge, click on one vertex and then click on another vertex.<br>
An edge will be created between the two selected vertices.
3. To create a vertex, click on empty space of a canvas.
4. To delete an object, double-click on it.

### Dependencies
- Jupyter notebook web environment.
- NetworkX library for graph manipulation.

### Notes
This function relies on Jupyter ipywidgets, so it should work only in web versions of Jupyter.
 (It is possible to run editor in VSCode but it is not guaranteed that it will work properly or even run at all)

### Installation instructions
go to: https://pypi.org/project/pygraphedit/ <br>
or run:
> pip install pygraphedit

### Examples
```python
import networkx as nx
from pygraphedit import edit

# Create a sample graph
G = nx.Graph()
G.add_nodes_from([1, 2, 3])
G.add_edges_from([(1, 2), (2, 3)])

# Call the interactive graph editor
edit(G)
