"""Back up the database and uploaded files to a timestamped archive.

    python -m scripts.backup [--out DIR]
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from datetime import datetime

from .common import ROOT, console, env


def main() -> int:
    ap = argparse.ArgumentParser(description="Back up Fedup AI data.")
    ap.add_argument("--out", default=str(ROOT / "backups"))
    args = ap.parse_args()

    out_dir = ROOT / args.out if not args.out.startswith("/") else None
    out_dir = out_dir or __import__("pathlib").Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dump = out_dir / f"db-{stamp}.sql"

    if shutil.which("docker") is None:
        console.print("[red]docker not found on PATH[/red]")
        return 1

    console.print("[bold]Dumping database…[/bold]")
    try:
        with open(dump, "wb") as fh:
            subprocess.run(
                ["docker", "compose", "exec", "-T", "db", "pg_dump",
                 "-U", env("POSTGRES_USER", "fedup"), env("POSTGRES_DB", "fedup")],
                cwd=ROOT, stdout=fh, check=True,
            )
    except subprocess.CalledProcessError as e:
        console.print(f"[red]pg_dump failed ({e.returncode}). Is the stack running?[/red]")
        dump.unlink(missing_ok=True)
        return 1
    console.print(f"  [green]✓[/green] {dump.name} ({dump.stat().st_size / 1e6:.1f} MB)")

    # Uploads and generated images live in named Docker volumes, so pull them
    # out through a throwaway container rather than reading the host disk.
    archive = out_dir / f"files-{stamp}.tar.gz"
    console.print("[bold]Archiving uploads and images…[/bold]")
    try:
        with open(archive, "wb") as fh:
            subprocess.run(
                ["docker", "run", "--rm",
                 "-v", "fedup-ai_uploads:/data/uploads:ro",
                 "-v", "fedup-ai_images:/data/images:ro",
                 "alpine", "tar", "czf", "-", "-C", "/data", "uploads", "images"],
                stdout=fh, check=True,
            )
        console.print(f"  [green]✓[/green] {archive.name} ({archive.stat().st_size / 1e6:.1f} MB)")
    except subprocess.CalledProcessError as e:
        console.print(f"  [yellow]could not archive files ({e.returncode})[/yellow]")
        archive.unlink(missing_ok=True)

    console.print(f"\n[green]Backup complete →[/green] {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
