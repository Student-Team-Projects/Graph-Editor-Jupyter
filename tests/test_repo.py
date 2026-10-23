import json
from pathlib import Path

ROOT = Path(__file__).parent.parent


def test_demo_notebook_is_committed_without_outputs():
    # Regression: outputs from running main.ipynb were committed twice. Clear them first
    # (in Jupyter: Edit -> Clear Outputs of All Cells, then save).
    notebook = json.loads((ROOT / "main.ipynb").read_text(encoding="utf-8"))
    code_cells = [c for c in notebook["cells"] if c["cell_type"] == "code"]
    assert all(not c.get("outputs") for c in code_cells)
    assert "widgets" not in notebook.get("metadata", {})


def test_bundled_libraries_ship_their_licences():
    # Regression: minifying stripped the MIT/ISC notices of Cytoscape.js and d3 from widget.js,
    # though those licences require them in every copy. `npm run build` now writes them.
    static = ROOT / "src" / "graph_editor_jupyter" / "static"
    notices = (static / "THIRD_PARTY_LICENSES.txt").read_text(encoding="utf-8")
    for package in ["cytoscape", "d3-force", "d3-dispatch", "d3-quadtree", "d3-timer"]:
        assert f"\n{package} " in notices
    assert notices.count("Permission") >= 5  # each licence's grant text, not just names
    assert "THIRD_PARTY_LICENSES.txt" in (static / "widget.js").read_text(encoding="utf-8")[:200]


def test_licence_names_the_real_authors():
    # Regression: LICENSE kept the Python packaging tutorial's placeholder owner.
    licence = (ROOT / "LICENSE").read_text(encoding="utf-8")
    assert "Python Packaging Authority" not in licence
    assert "Andrii Kovryhin" in licence and "contributors" in licence
