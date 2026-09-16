"""Shared helpers: env loading and service endpoints."""
from __future__ import annotations

import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from rich.console import Console

ROOT = Path(__file__).resolve().parent.parent
console = Console()

load_dotenv(ROOT / ".env")


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


def ollama_url() -> str:
    """From the host, Ollama is on localhost — the container alias won't resolve here."""
    url = env("OLLAMA_URL", "http://localhost:11434")
    return url.replace("host.docker.internal", "localhost")


def comfy_url() -> str:
    return env("COMFYUI_URL", "http://localhost:8188").replace("comfyui", "localhost")


def app_url() -> str:
    return env("APP_URL", "http://localhost:3000")


def client(timeout: float = 30.0) -> httpx.Client:
    return httpx.Client(timeout=timeout, follow_redirects=True)
