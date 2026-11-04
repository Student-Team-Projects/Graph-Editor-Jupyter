import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).parent.parent
_spec = importlib.util.spec_from_file_location("run", ROOT / "run.py")
run = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(run)


def _touch(path: Path, mtime: float) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("")
    os.utime(path, (mtime, mtime))


def test_missing_bundle_is_stale(tmp_path):
    _touch(tmp_path / "src" / "widget.ts", 100)
    assert run.frontend_is_stale(tmp_path / "src", tmp_path / "widget.js")


def test_bundle_newer_than_sources_is_fresh(tmp_path):
    _touch(tmp_path / "src" / "widget.ts", 100)
    _touch(tmp_path / "widget.js", 200)
    assert not run.frontend_is_stale(tmp_path / "src", tmp_path / "widget.js")


def test_changed_source_or_css_is_stale(tmp_path):
    _touch(tmp_path / "widget.js", 200)
    _touch(tmp_path / "src" / "widget.css", 300)
    assert run.frontend_is_stale(tmp_path / "src", tmp_path / "widget.js")


def test_changed_test_file_does_not_need_rebuild(tmp_path):
    _touch(tmp_path / "widget.js", 200)
    _touch(tmp_path / "src" / "forces.test.ts", 300)
    assert not run.frontend_is_stale(tmp_path / "src", tmp_path / "widget.js")


def test_venv_python_finds_either_layout(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "IS_WINDOWS", False)
    assert run.venv_python(tmp_path) is None
    _touch(tmp_path / "bin" / "python", 1)
    assert run.venv_python(tmp_path) == tmp_path / "bin" / "python"
    _touch(tmp_path / "Scripts" / "python.exe", 1)
    assert run.venv_python(tmp_path) == tmp_path / "Scripts" / "python.exe"


def test_windows_ignores_a_linux_venv(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "IS_WINDOWS", True)
    _touch(tmp_path / "bin" / "python", 1)
    assert run.venv_python(tmp_path) is None


def test_no_fast_rebuild_on_a_fresh_clone(tmp_path, monkeypatch):
    # Regression: run.py ran `npm run build` before anyone had run `npm install`, and crashed.
    monkeypatch.setattr(run.shutil, "which", lambda name: f"/usr/bin/{name}")
    assert run.fast_build_commands(tmp_path / "node_modules") == []


def test_fast_rebuild_uses_npm_when_node_modules_exist(tmp_path, monkeypatch):
    monkeypatch.setattr(run.shutil, "which", lambda name: f"/usr/bin/{name}")
    assert run.fast_build_commands(tmp_path) == [["/usr/bin/npm", "run", "build"]]


def test_fast_rebuild_falls_back_to_npm_in_wsl_on_windows(tmp_path, monkeypatch):
    monkeypatch.setattr(run.shutil, "which", lambda name: "wsl.exe" if name == "wsl" else None)
    monkeypatch.setattr(run, "IS_WINDOWS", True)
    assert run.fast_build_commands(tmp_path)[0][0] == "wsl"


def test_no_fast_rebuild_without_node(tmp_path, monkeypatch):
    monkeypatch.setattr(run.shutil, "which", lambda name: None)
    monkeypatch.setattr(run, "IS_WINDOWS", False)
    assert run.fast_build_commands(tmp_path) == []


def test_failed_venv_leaves_nothing_behind(tmp_path, monkeypatch):
    # Regression: without python3-venv, `python -m venv` fails after creating bin/python. The next
    # run then took that for a working venv and failed again, even after installing the package.
    venv = tmp_path / ".venv"

    def failing_venv(command, **kwargs):
        _touch(venv / "bin" / "python", 1)
        return SimpleNamespace(returncode=1)

    monkeypatch.setattr(run, "VENV", venv)
    monkeypatch.setattr(run.subprocess, "run", failing_venv)
    with pytest.raises(SystemExit, match="python3-venv"):
        run.setup()
    assert not venv.exists()


def test_jupyter_runs_from_the_project_environment():
    # Regression: `python -m jupyter lab` ran the first jupyter-lab on PATH, so another
    # environment's Jupyter could open the notebook without our package.
    python = Path("venv-python")
    command = run.jupyter_command(python)
    assert command[:3] == [python, "-m", "jupyterlab"]
