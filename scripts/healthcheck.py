"""Check every moving part of the stack.

    python -m scripts.healthcheck
"""
from __future__ import annotations

import sys

import httpx
from rich.table import Table

from .common import app_url, client, comfy_url, console, env, ollama_url


def probe(name: str, url: str, required: bool) -> tuple[str, str, bool]:
    try:
        with client(timeout=4) as c:
            r = c.get(url)
        if r.status_code < 500:
            return name, f"[green]up[/green] ({r.status_code})", True
        return name, f"[red]error {r.status_code}[/red]", not required
    except httpx.HTTPError as e:
        state = "[red]down[/red]" if required else "[yellow]down (optional)[/yellow]"
        return name, f"{state} — {type(e).__name__}", not required


def main() -> int:
    console.rule("[bold]Fedup AI health")

    checks = [
        ("Web app", f"{app_url()}/api/health", True),
        ("Ollama", f"{ollama_url()}/api/tags", True),
        ("ComfyUI", f"{comfy_url()}/system_stats", False),
    ]

    table = Table(show_header=True, header_style="bold")
    table.add_column("Service")
    table.add_column("Status")
    all_ok = True
    for name, url, required in checks:
        n, status, ok = probe(name, url, required)
        table.add_row(n, status)
        all_ok &= ok
    console.print(table)

    # Confirm the models the app actually depends on are pulled.
    try:
        with client(timeout=5) as c:
            tags = c.get(f"{ollama_url()}/api/tags").json()
        have = {m["name"] for m in tags.get("models", [])}
        console.print("\n[bold]Models[/bold]")
        for key, default in (
            ("OLLAMA_CHAT_MODEL", "gemma3:latest"),
            ("OLLAMA_EMBED_MODEL", "nomic-embed-text"),
        ):
            want = env(key, default)
            present = want in have or f"{want}:latest" in have
            mark = "[green]✓[/green]" if present else "[red]missing[/red]"
            console.print(f"  {mark} {want}")
            if not present:
                all_ok = False
                console.print(f"    [dim]fix: ollama pull {want}[/dim]")
    except (httpx.HTTPError, KeyError, ValueError):
        console.print("[yellow]Could not list Ollama models.[/yellow]")

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
