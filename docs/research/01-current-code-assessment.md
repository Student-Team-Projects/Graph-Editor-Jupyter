# Current code assessment

Date: 2026-10-23. Code at commit `e3a393f` ("final version", January 2026), version 0.0.6 in `pyproject.toml`.

## Size and structure

About 1300 lines of Python in `src/graph_editor_jupyter/`:

| File | Lines | Role |
|---|---|---|
| `edit.py` | 473 | The whole `edit()` function: UI, mouse handlers, label panel, main loop thread |
| `graph_physics.py` | 332 | pymunk physics, `DrawingMode` enum |
| `graphics.py` | 210 | Canvas drawing, widget classes |
| `visual_graph.py` | 160 | Graph + coordinates, selection, labels |
| `fancy_drawing.py` | 105 | Planarity check, Tutte embedding |
| `subscribe.py`, `settings.py`, `debug.py` | 32 | Observer decorator, constants, debug box |

There are no automated tests.

## Confirmed bugs (reproduced by running the code)

### 1. The planarity check is wrong

`is_tutte()` in `fancy_drawing.py` uses `if nx.check_planarity(graph) and ...`. But `nx.check_planarity` returns a tuple `(is_planar, embedding)`, and a non-empty tuple is always true. So every graph passes the planarity part.

Result of running it:

| Graph | Really planar? | `is_tutte()` says |
|---|---|---|
| K5 | No | True |
| K3,3 | No | True |
| Petersen graph | No | True |
| Cube (3-dimensional hypercube) | Yes, 3-connected | True |
| Path P5 | Yes, not 3-connected | False |
| Cycle C6 | Yes, 2-connected | False |

Consequence: "fancy drawing" accepts non-planar graphs and draws a Tutte embedding for them, which has crossings even though the feature promises none.

### 2. The README example is mathematically wrong

The README and `main.ipynb` call the Petersen graph "planar and 3-connected" and use it to demo the crossing-free drawing. The Petersen graph is not planar. The demo only "works" because of bug 1.

### 3. `VisualGraph.label_node` always crashes

It refers to `self.node_labels`, which does not exist (the attribute is `vertex_labels`). Calling it raises `AttributeError`.

## Problems found by reading (not yet reproduced)

- **Crossing-free drawing only for 3-connected planar graphs.** Planar graphs that are not 3-connected (trees, cycles) are refused. The professor wants every planar graph drawn without crossings, and non-planar graphs with few crossings.
- **Not the default.** The crossing-free drawing is behind button 6. The professor wants it as the first layout.
- **Architecture.** All drawing happens in Python. A background thread redraws the canvas about 30 times per second, and every frame is sent from the kernel to the browser. This is slow for larger graphs and fragile (threads plus widgets).
- **One 473-line function.** `edit()` contains about 25 nested functions sharing state through `nonlocal`. It is hard to read, test or change.
- **Errors are hidden.** The main loop catches all exceptions and writes them to a debug text box that is never displayed.
- **Wrong error type for user errors.** Fancy drawing on an unsupported graph raises `NotImplementedError` with the message "Cannot only use fancy drawing...".
- **Mutable default argument.** `edit(graph, color_dict={})` shares one dict across all calls.
- **Leftovers.** A helper named `get_some_other_label_that_i_dont_know_what_it_is`, commented-out code, a mix of Polish and English comments.
- **Packaging.** `requirements.txt` is saved as UTF-16 and pins old versions. It duplicates `pyproject.toml`, which lists runtime dependencies such as `jedi`, `parso` and `wcwidth` that the code never imports.
- **Version mismatch.** PyPI has version 0.0.7 (uploaded 2026-01-22), but `pyproject.toml` in the repository says 0.0.6. We compared the published wheel file by file: the code is identical, so only the version number in the repo was never updated.

## What is worth keeping

- The public API idea: `edit(graph, color_dict)` edits a NetworkX graph in place.
- The label (attribute) editing concept.
- The Tutte embedding code (fine once the planarity check is fixed; useful for 3-connected planar graphs).
