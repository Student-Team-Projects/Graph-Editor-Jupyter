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
