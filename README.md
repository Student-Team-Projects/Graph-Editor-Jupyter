## Interactive Graph Editor for Jupyter

An interactive graph editor function designed for Jupyter notebooks. ```edit(graph: nx.Graph)``` function allows users <br>
to manipulate a graph by creating vertices, edges, and adding labels directly within a Jupyter environment.

### Parameters
- **graph** (*networkx.Graph*): The graph object to be edited.
  It should be an instance of the NetworkX Graph class or a subclass.
- **color_dict** (*Dict[str, str]*): Map of color labels into HTML colors,
  empty by default.

### Functions of buttons (from left to right)
1. Select if you want to edit graph structure.
2. Select if you want to edit labels.
3. Select if you want for nodes to be clickable.
    Deselecting this should make it easier to operate on edges in a large graph.
4. Select if you want for edges to be clickable.
    Deselecting this should make it easier to operate on nodes in a large graph.
5. Turn on/off physics.
6. Turn on/off fancy drawing (planar representation of a graph, works only for 3-connected planar graphs).
7. Enable/disable labels.
8. Exit the editor.

### Mouse Functions
1. Click and drag vertices to move them around the canvas.
2. To create an edge, click on one vertex and then click on another vertex.<br>
An edge will be created between the two selected vertices.
3. To create a vertex, click on empty space on the canvas.
4. To delete an object, double-click on it.

### Dependencies
- Jupyter notebook web environment.
- NetworkX library for graph manipulation.

### Notes
This function relies on Jupyter ipywidgets, so it should work only in web versions of Jupyter.
 (It is possible to run editor in VSCode but it is not guaranteed that it will work properly or even run at all.)

### Installation instructions
go to: https://pypi.org/project/graph-editor-jupyter/ <br>
or run:
> pip install graph-editor-jupyter

### Examples

#### Creating and editing a new graph

```python
import networkx as nx
from graph_editor_jupyter import edit

# Create a sample graph
simple_graph = nx.Graph()
simple_graph.add_node(1)
simple_graph.add_node(2)
simple_graph.add_edge(1, 2)

# Open simple_graph in the editor
edit(simple_graph)
```
#### Labels and graph coloring

```python
import networkx as nx
from graph_editor_jupyter import edit

labeled_graph = nx.Graph()

# Add nodes with labels (labels can be also edited and added in the editor)
labeled_graph.add_node(1, label_name='A')
labeled_graph.add_node(2, label_name='B')
labeled_graph.add_edge(1, 2)

# Add nodes with colors, label with name 'color' (additional colors can be added in the editor)
labeled_graph.add_node(3, color='c')
labeled_graph.add_node(4, color='g')
labeled_graph.add_edge(3, 4)

# Define custom colors for labels (otherwise random colors are used)
# label_colors={'color label': 'HTML color (Hex RGB or name)'}
label_colors={'c' : '#00FFFF', 'g': 'green'} 

# Open labeled_graph in the editor
edit(labeled_graph, label_colors)
```
#### Displaying planar representation* of a graph
##### **You can use fancy drawing for 3-connected planar graphs*

```python
import networkx as nx
from graph_editor_jupyter import edit

# Create a sample planar and 3-connected graph
petersen_graph = nx.petersen_graph()

# Open petersen_graph in the editor
edit(petersen_graph)

# To display planar representation of a graph, in the editor, 
# change the drawing mode to 'fancy drawing' (6th button from the left) 
```