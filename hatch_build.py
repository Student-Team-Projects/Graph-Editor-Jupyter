"""Builds the front end while the package is built, so installing needs only Python.

Every install path goes through here: pip install -e ., pip install ., pip install git+https://...
The bundle is not in git, and pip fetches Node.js itself (nodejs-wheel-binaries, see
[build-system] in pyproject.toml), so nobody has to install Node just to run the project.
"""

import importlib.util
import os
import shutil
import tempfile
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


def build_frontend(root: Path, npm, node_dir: Path) -> None:
    """Runs npm in a temporary copy of js/, then copies the bundle into the package.

    A copy because js/node_modules may belong to another platform (on our machines npm runs in
    WSL and Python on Windows), and a build here must not replace it.
    """
    static = Path("src") / "graph_editor_jupyter" / "static"
    env = {**os.environ, "PATH": f"{node_dir}{os.pathsep}{os.environ.get('PATH', '')}"}
    with tempfile.TemporaryDirectory() as tmp:
        js = Path(tmp) / "js"
        shutil.copytree(root / "js", js, ignore=shutil.ignore_patterns("node_modules", ".test"))
        # --include=dev: the build tools are dev dependencies, even if NODE_ENV=production here.
        npm(["ci", "--include=dev", "--no-audit", "--no-fund"], cwd=js, env=env, check=True)
        npm(["run", "build"], cwd=js, env=env, check=True)
        shutil.copytree(Path(tmp) / static, root / static, dirs_exist_ok=True)


def _load_run(root: Path):
    spec = importlib.util.spec_from_file_location("run", root / "run.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FrontEndBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        root = Path(self.root)
        run = _load_run(root)
        if not run.frontend_is_stale(run.JS_SRC, run.BUNDLE):
            return
        import nodejs_wheel

        package = Path(nodejs_wheel.__file__).parent
        self.app.display_info("Building the front end (first time: about a minute)...")
        build_frontend(root, nodejs_wheel.npm, package if os.name == "nt" else package / "bin")
