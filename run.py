"""Start the demo: rebuild the front end if needed, then open main.ipynb in JupyterLab.

Run with the project's Python (in PyCharm: Shift+F10 on the "Run demo" configuration).
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
JS_SRC = ROOT / "js" / "src"
BUNDLE = ROOT / "src" / "graph_editor_jupyter" / "static" / "widget.js"


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


def build_command() -> list[str]:
    """npm if it is on PATH; otherwise, on Windows, npm inside WSL."""
    npm = shutil.which("npm")
    if npm:
        return [npm, "run", "build"]
    if os.name == "nt" and shutil.which("wsl"):
        # Interactive shell so nvm (loaded in ~/.bashrc) puts npm on PATH.
        return ["wsl", "bash", "-ic", "npm run build"]
    sys.exit("npm not found: install Node.js 18+ (see docs/development.md)")


def main() -> None:
    if frontend_is_stale(JS_SRC, BUNDLE):
        print("Front end changed, rebuilding...")
        subprocess.run(build_command(), cwd=ROOT / "js", check=True)
    subprocess.run(
        [sys.executable, "-m", "jupyter", "lab", "main.ipynb"], cwd=ROOT, check=True
    )


if __name__ == "__main__":
    main()
