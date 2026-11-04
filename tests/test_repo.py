import json
import shutil
import subprocess
from pathlib import Path

import pytest

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


def test_npm_test_lists_test_files_itself():
    # Regression: `node --test .test/` failed on Node 22+ ("Cannot find module .test"), which
    # no longer accepts a directory, so every TypeScript test looked like one failure.
    scripts = json.loads((ROOT / "js" / "package.json").read_text(encoding="utf-8"))["scripts"]
    assert "node --test" not in scripts["test"]
    assert "node scripts/run-tests.mjs .test" in scripts["test"]


@pytest.mark.skipif(shutil.which("node") is None, reason="needs Node.js")
@pytest.mark.parametrize("body, status", [("assert.ok(true)", 0), ("assert.ok(false)", 1)])
def test_test_runner_reports_the_result(tmp_path, body, status):
    (tmp_path / "a.test.mjs").write_text(
        f'import test from "node:test";\nimport assert from "node:assert";\ntest("a", () => {body});\n'
    )
    runner = ROOT / "js" / "scripts" / "run-tests.mjs"
    result = subprocess.run(["node", runner, tmp_path], capture_output=True, text=True)
    assert result.returncode == status, result.stdout + result.stderr


@pytest.mark.skipif(shutil.which("node") is None, reason="needs Node.js")
def test_test_runner_fails_without_tests(tmp_path):
    runner = ROOT / "js" / "scripts" / "run-tests.mjs"
    assert subprocess.run(["node", runner, tmp_path], capture_output=True).returncode == 1
