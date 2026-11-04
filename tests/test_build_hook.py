import importlib.util
from pathlib import Path

import pytest

pytest.importorskip("hatchling")  # only in a venv installed before the hook existed

ROOT = Path(__file__).parent.parent
_spec = importlib.util.spec_from_file_location("hatch_build", ROOT / "hatch_build.py")
hatch_build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hatch_build)


def _fake_project(root: Path) -> None:
    (root / "js" / "node_modules" / "esbuild").mkdir(parents=True)
    (root / "js" / "node_modules" / "esbuild" / "marker").write_text("other platform")
    (root / "js" / "package.json").write_text("{}")


def test_build_puts_the_bundle_in_the_package_and_leaves_node_modules_alone(tmp_path):
    # node_modules can belong to another platform (npm in WSL, Python on Windows).
    _fake_project(tmp_path)
    calls = []

    def fake_npm(args, cwd, env, check):
        calls.append((args[0], Path(cwd).name, (Path(cwd) / "node_modules").exists(), env["PATH"]))
        if args[0] == "run":
            static = Path(cwd).parent / "src" / "graph_editor_jupyter" / "static"
            static.mkdir(parents=True)
            (static / "widget.js").write_text("bundle")

    hatch_build.build_frontend(tmp_path, fake_npm, Path("NODE-DIR"))
    assert [c[0] for c in calls] == ["ci", "run"]
    assert all(not has_modules for _, _, has_modules, _ in calls)  # worked in a clean copy
    assert all(path.startswith("NODE-DIR") for *_, path in calls)  # npm scripts can find node
    assert (tmp_path / "src" / "graph_editor_jupyter" / "static" / "widget.js").read_text() == "bundle"
    assert (tmp_path / "js" / "node_modules" / "esbuild" / "marker").read_text() == "other platform"


def test_pyproject_wires_up_the_hook_and_brings_node():
    # Regression: a fresh clone or `pip install git+...` had no front end, and importing crashed.
    config = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert '"nodejs-wheel-binaries' in config.split("[build-system]")[1].split("\n[")[0]
    assert "[tool.hatch.build.targets.wheel.hooks.custom]" in config
    assert 'artifacts = ["src/graph_editor_jupyter/static/*"]' in config


def test_no_python_version_pin_in_the_repo():
    # Regression: .python-version made `python` fail in this folder for everyone using pyenv.
    assert not (ROOT / ".python-version").exists()
