import importlib.util
import os
from pathlib import Path

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
