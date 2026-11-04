"""Start the demo with one command: python run.py (or Shift+F10 on "Run demo" in PyCharm).

Needs only Python 3.10+. The first run creates .venv and installs everything into it; later runs
rebuild the front end if needed and open main.ipynb in JupyterLab.
"""

from __future__ import annotations  # so that older Pythons reach the version message below

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
JS = ROOT / "js"
JS_SRC = JS / "src"
BUNDLE = ROOT / "src" / "graph_editor_jupyter" / "static" / "widget.js"
MIN_PYTHON = (3, 10)
IS_WINDOWS = os.name == "nt"


def frontend_is_stale(src_dir: Path, bundle: Path) -> bool:
    """True if the bundle is missing or older than any TypeScript/CSS source."""
    if not bundle.exists():
        return True
    built = bundle.stat().st_mtime
    return any(
        f.stat().st_mtime > built
        for f in src_dir.rglob("*")
        if f.suffix in (".ts", ".css") and not f.name.endswith(".test.ts")
    )


def venv_python(venv: Path) -> Path | None:
    """The venv's interpreter. A Windows venv also works from WSL, but not the other way round."""
    candidates = [venv / "Scripts" / "python.exe"]
    if not IS_WINDOWS:
        candidates.append(venv / "bin" / "python")
    return next((c for c in candidates if c.exists()), None)


def is_ready(python: Path) -> bool:
    check = "import jupyterlab, graph_editor_jupyter"
    return subprocess.run([python, "-c", check], capture_output=True, cwd=ROOT).returncode == 0


def setup() -> Path:
    """The project's interpreter, creating and filling .venv on the first run."""
    python = venv_python(VENV)
    if python and is_ready(python):
        return python
    if sys.version_info < MIN_PYTHON:
        sys.exit(f"Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]}+ is needed; this is {sys.version.split()[0]}.")
    if not python:
        print("First run: creating .venv ...")
        if subprocess.run([sys.executable, "-m", "venv", VENV]).returncode != 0:
            shutil.rmtree(VENV, ignore_errors=True)  # a half-made venv would be picked up next time
            sys.exit("Could not create .venv. On Debian/Ubuntu: sudo apt install python3-venv, then run again.")
        python = venv_python(VENV)
    print("Installing the project and JupyterLab (first time: a few minutes) ...")
    if subprocess.run([python, "-m", "pip", "install", "-e", ".[dev]"], cwd=ROOT).returncode != 0:
        sys.exit("Installing failed; see the messages above. Deleting .venv and running again often helps.")
    return python


def fast_build_commands(node_modules: Path) -> list[list[str]]:
    """Ways to rebuild with a Node already set up for development: npm, or on Windows npm in WSL."""
    if not node_modules.exists():
        return []
    npm = shutil.which("npm")
    if npm:
        return [[npm, "run", "build"]]
    if IS_WINDOWS and shutil.which("wsl"):
        # Interactive shell so nvm (loaded in ~/.bashrc) puts npm on PATH.
        return [["wsl", "bash", "-ic", "npm run build"]]
    return []


def rebuild_frontend(python: Path) -> None:
    print("Front end changed, rebuilding...")
    for command in fast_build_commands(JS / "node_modules"):
        if subprocess.run(command, cwd=JS).returncode == 0:
            return
    # No usable Node here. Reinstalling runs hatch_build.py, which brings its own.
    command = [python, "-m", "pip", "install", "-e", ".", "--no-deps"]
    if subprocess.run(command, cwd=ROOT).returncode != 0:
        sys.exit("Rebuilding the front end failed; see the messages above.")


def jupyter_command(python: Path) -> list:
    # Not `-m jupyter lab`: that runs the first jupyter-lab on PATH, which can belong to another
    # environment (Anaconda, say), whose kernel doesn't have our package.
    return [python, "-m", "jupyterlab", "main.ipynb"]


def main() -> None:
    python = setup()
    if frontend_is_stale(JS_SRC, BUNDLE):
        rebuild_frontend(python)
    subprocess.run(jupyter_command(python), cwd=ROOT)


if __name__ == "__main__":
    main()
