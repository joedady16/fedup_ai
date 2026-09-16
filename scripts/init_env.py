"""Create .env from .env.example, filling in strong random secrets.

    python -m scripts.init_env [--force]
"""
from __future__ import annotations

import argparse
import re
import secrets
import sys

from .common import ROOT, console


def main() -> int:
    ap = argparse.ArgumentParser(description="Initialise the project .env file.")
    ap.add_argument("--force", action="store_true", help="overwrite an existing .env")
    args = ap.parse_args()

    example = ROOT / ".env.example"
    target = ROOT / ".env"

    if target.exists() and not args.force:
        console.print("[yellow].env already exists.[/yellow] Use --force to regenerate.")
        return 0
    if not example.exists():
        console.print("[red].env.example is missing.[/red]")
        return 1

    text = example.read_text()
    db_password = secrets.token_urlsafe(24)

    # Random secrets; the admin credentials stay for the user to choose.
    text = re.sub(r"^AUTH_SECRET=.*$", f"AUTH_SECRET={secrets.token_urlsafe(48)}",
                  text, flags=re.M)
    text = re.sub(r"^POSTGRES_PASSWORD=.*$", f"POSTGRES_PASSWORD={db_password}",
                  text, flags=re.M)
    text = re.sub(r"^DATABASE_URL=.*$",
                  f"DATABASE_URL=postgres://fedup:{db_password}@db:5432/fedup",
                  text, flags=re.M)

    target.write_text(text)
    target.chmod(0o600)

    console.print(f"[green]✓[/green] wrote {target.name} with fresh secrets")
    console.print("\n[bold]Now set your own admin login in .env:[/bold]")
    console.print("  ADMIN_EMAIL=you@example.com")
    console.print("  ADMIN_PASSWORD=<something you'll remember>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
