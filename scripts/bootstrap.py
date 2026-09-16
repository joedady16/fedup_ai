"""One-time setup: pull the Ollama models and fetch the image checkpoint.

    python -m scripts.bootstrap            # everything
    python -m scripts.bootstrap --no-image # skip the 7GB checkpoint
"""
from __future__ import annotations

import argparse
import sys

import httpx
from rich.progress import (
    BarColumn, DownloadColumn, Progress, TextColumn, TimeRemainingColumn,
)

from .common import ROOT, client, console, env, ollama_url

# SDXL-Turbo: distilled for 1-4 step sampling, which is what makes image
# generation practical on an 8GB card that is also serving the chat model.
CHECKPOINT_URL = (
    "https://huggingface.co/stabilityai/sdxl-turbo/resolve/main/"
    "sd_xl_turbo_1.0_fp16.safetensors"
)


def pull_model(name: str) -> bool:
    """Streams an `ollama pull`, reporting progress."""
    console.print(f"[bold]Pulling[/bold] {name} …")
    try:
        with client(timeout=None) as c, c.stream(
            "POST", f"{ollama_url()}/api/pull", json={"model": name}
        ) as r:
            if r.status_code != 200:
                console.print(f"  [red]failed[/red] ({r.status_code})")
                return False
            last = ""
            for line in r.iter_lines():
                if not line:
                    continue
                import json as _json

                try:
                    status = _json.loads(line).get("status", "")
                except _json.JSONDecodeError:
                    continue
                if status and status != last:
                    console.print(f"  [dim]{status}[/dim]")
                    last = status
        console.print(f"  [green]✓[/green] {name}")
        return True
    except httpx.HTTPError as e:
        console.print(f"  [red]✗[/red] {name}: {e}")
        return False


def download_checkpoint() -> bool:
    dest_dir = ROOT / "comfy" / "models" / "checkpoints"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / env("COMFYUI_MODEL", "sd_xl_turbo_1.0_fp16.safetensors")

    if dest.exists() and dest.stat().st_size > 1_000_000:
        console.print(f"[green]✓[/green] checkpoint already present ({dest.name})")
        return True

    console.print(f"[bold]Downloading[/bold] {dest.name} (~7GB, one time) …")
    tmp = dest.with_suffix(".part")
    try:
        with client(timeout=None) as c, c.stream("GET", CHECKPOINT_URL) as r:
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0))
            with Progress(
                TextColumn("  [progress.description]{task.description}"),
                BarColumn(), DownloadColumn(), TimeRemainingColumn(),
                console=console,
            ) as bar:
                task = bar.add_task("checkpoint", total=total or None)
                with open(tmp, "wb") as fh:
                    for block in r.iter_bytes(chunk_size=1 << 20):
                        fh.write(block)
                        bar.update(task, advance=len(block))
        tmp.rename(dest)
        console.print(f"  [green]✓[/green] saved to {dest.relative_to(ROOT)}")
        return True
    except (httpx.HTTPError, OSError) as e:
        tmp.unlink(missing_ok=True)
        console.print(f"  [red]✗[/red] {e}")
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description="Set up models for Fedup AI.")
    ap.add_argument("--no-image", action="store_true", help="skip the image checkpoint")
    args = ap.parse_args()

    console.rule("[bold]Fedup AI bootstrap")

    try:
        with client(timeout=5) as c:
            c.get(f"{ollama_url()}/api/tags").raise_for_status()
    except httpx.HTTPError:
        console.print(f"[red]Ollama is not reachable at {ollama_url()}[/red]")
        console.print("Start it with:  ollama serve")
        return 1

    ok = True
    # The embedding model is required; chat models may already be present.
    for model in (env("OLLAMA_EMBED_MODEL", "nomic-embed-text"),
                  env("OLLAMA_CHAT_MODEL", "gemma3:latest")):
        ok &= pull_model(model)

    if not args.no_image:
        ok &= download_checkpoint()

    console.rule("[green]Done" if ok else "[yellow]Finished with problems")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
