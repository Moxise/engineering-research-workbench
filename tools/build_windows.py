"""Build a portable x64 executable and a distribution ZIP without personal data."""
from __future__ import annotations

import hashlib
import argparse
import json
import shutil
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def stage_resources(root: Path, target: Path) -> list[tuple[Path, str]]:
    """Stage code/assets only; never copy plugin runtime data into an executable."""
    blocked = {"data", "config", "workspace", "__pycache__", "node_modules"}
    suffixes = {".py", ".js", ".css", ".html", ".json", ".md", ".png", ".svg",
                ".bcmap", ".pfb", ".ttf", ".otf", ".woff", ".woff2", ".map", ".txt"}
    resources = []
    for relative in ("web", "plugins", "docs/manual"):
        source = root / relative
        for file in sorted(source.rglob("*")):
            parts = file.relative_to(source).parts
            if (not file.is_file() or file.is_symlink()
                    or (relative == "plugins" and "build" in parts)
                    or any(part.startswith((".", "_verify_", "_preview_", "_timing_"))
                           or part.lower() in blocked for part in parts)
                    or file.suffix.lower() not in suffixes):
                continue
            dest = target / relative / file.relative_to(source)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, dest)
        if (target / relative).is_dir():
            resources.append((target / relative, relative))
    return resources


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", choices=("ResearchWorkbench","ResearchWorkbench-Updated"), default="ResearchWorkbench")
    args = parser.parse_args()
    if sys.platform != "win32" or sys.version_info < (3, 11) or struct.calcsize("P") != 8:
        raise SystemExit("Build with Windows x64 Python 3.11+ in build/.venv.")
    if sys.prefix == sys.base_prefix:
        raise SystemExit("Use build/.venv/Scripts/python.exe to isolate build dependencies.")
    from PIL import Image
    build = ROOT / "build"
    build.mkdir(exist_ok=True)
    icon = build / "research-workstation.ico"
    with Image.open(ROOT / "web" / "favicon.png") as source:
        source.save(icon, sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
    import tempfile
    scratch = ROOT / ".scratch" / "tmp"
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="windows-assets-", dir=scratch) as temporary:
        resources = stage_resources(ROOT, Path(temporary))
        data_args = [arg for source, dest in resources for arg in ("--add-data", f"{source};{dest}")]
        subprocess.run([
            sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--windowed",
            "--name", args.name, "--distpath", str(ROOT), "--specpath", str(build),
            "--workpath", str(build / "pyinstaller"), "--icon", str(icon),
            *data_args, "--add-data", f"{ROOT / 'VERSION'};.",
            "--collect-submodules", "app", "--collect-submodules", "core",
            "--hidden-import", "core_api", "--hidden-import", "xml.etree.ElementTree",
            "--hidden-import", "xml.sax.saxutils",
            "--add-data", f"{icon};.", str(ROOT / "client.py"),
        ], cwd=ROOT, check=True)
    executable = ROOT / (args.name + ".exe")
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    archive = dist / "ResearchWorkbench-Windows-x64.zip"
    # Explicit allowlist: config, Workspace, secrets, profiles and logs are never
    # staged or included. Fresh installs initialize their own data beside the exe.
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        bundle.write(executable, "ResearchWorkbench.exe")
        bundle.write(ROOT / "docs" / "WINDOWS.md", "使用说明.md")
        bundle.write(ROOT / "LICENSE.txt", "LICENSE.txt")
    artifacts = []
    for file in (executable, archive):
        with file.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        artifacts.append({"file":file.name,"bytes":file.stat().st_size,"sha256":digest})
    manifest = {
        "version": (ROOT / "VERSION").read_text(encoding="utf-8").strip(),
        "architecture": "Windows x64", "python": sys.version.split()[0],
        "artifacts": artifacts,
    }
    (dist / "windows-build.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
