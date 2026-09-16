# Fedup AI

A private AI assistant for your household. Chat, analyse documents, and generate
pictures — running on your own machine, with an account for each family member.

Nothing leaves the house unless you explicitly turn on smart mode.

---

## What it does

- **Chat** with streaming replies, backed by a local model (Ollama) by default.
- **Reads your documents** — upload a PDF, DOCX, TXT, MD or CSV and ask questions
  about it. Answers cite which file they came from.
- **Draws pictures** from a description, using Stable Diffusion on your GPU.
- **Learns over time** — it remembers durable facts about each person and recalls
  them in later conversations.
- **Family accounts** — admin / adult / kid roles, with content filtering and
  parent visibility for children.

### How "learning" actually works

It is *retrieval-based*, not fine-tuning. Your files and the facts it picks up are
embedded and stored in Postgres; relevant pieces are pulled back into the prompt
on later questions. The model's weights are never modified. This is the right
trade-off for a home server — it is instant, reversible, and per-person.

---

## Requirements

- **Docker Desktop** with WSL integration enabled for this distro
- **Ollama** running on the host (`ollama serve`)
- An NVIDIA GPU is recommended; 8GB VRAM is enough
- Python 3.10+ for the setup tooling

---

## Setup

```bash
# 1. Ops tooling
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. Config — generates strong secrets into .env
python -m scripts.init_env

# 3. Set your admin login
#    Edit .env:  ADMIN_EMAIL=you@example.com
#                ADMIN_PASSWORD=something-you-will-remember

# 4. Models (pulls the embedding + chat model, downloads the image checkpoint)
python -m scripts.bootstrap
#    Skip the 7GB image model for now with:  --no-image

# 5. Start
docker compose up -d --build
```

Open **http://localhost:3080** and sign in with the admin credentials from `.env`.

To enable picture generation:

```bash
docker compose --profile images up -d --build
```

The first build of that container is large (PyTorch + CUDA) and the first render
takes a minute while the model pages into VRAM.

### Sharing one GPU

An 8GB card cannot hold the chat model and the image model at the same time, so
the app hands the GPU over explicitly: before a render it asks Ollama to drop its
resident models, and afterwards it tells ComfyUI to release its checkpoint. The
next chat message reloads the chat model, which costs a few seconds.

Set `FREE_VRAM_FOR_IMAGES=false` in `.env` to disable this — only sensible on a
card with enough memory for both (roughly 16GB or more).

---

## Everyday commands

```bash
python -m scripts.healthcheck    # is everything up?
python -m scripts.backup         # dump the database + uploaded files
docker compose logs -f web       # tail app logs
docker compose down              # stop
```

---

## Adding your family

Sign in as admin → **Family settings** → *Add account*.

| Role | Can do |
|---|---|
| `admin` | Everything, plus manage accounts and read anyone's chats |
| `adult` | Unrestricted chat, documents and images |
| `kid` | Filtered prompts, age-appropriate system prompt, safety negative prompt on images, all refusals logged for you |

Child safety works in three layers: a keyword gate before anything reaches a
model, a strict system prompt that resists being talked out of its rules, and a
forced negative prompt on image generation. Every block is recorded on the admin
page. Treat it as a good seatbelt, not a locked door — no filter is perfect, and
it is not a substitute for knowing what your kids are up to.

---

## Local vs smart mode

| | Local (default) | Smart mode |
|---|---|---|
| Runs on | Your GPU, via Ollama | Anthropic's API |
| Cost | Free | Per token |
| Privacy | Never leaves the machine | Prompt is sent to Anthropic |
| Good for | Everyday questions, private documents | Hard reasoning, long documents |

Smart mode uses **Claude Opus 5** and only appears in the UI when
`ANTHROPIC_API_KEY` is set in `.env`. It is a per-message toggle, off by default.

---

## Ports

`3000`, `5432` and `5433` were already in use on this machine, so the stack uses:

| Service | Host port |
|---|---|
| Web app | **3080** |
| Postgres | **5434** |
| ComfyUI | **8188** |

---

## Architecture

```
Browser ──▶ Next.js (web, :3080)
               │
               ├─▶ Postgres + pgvector (:5434)   chats, users, embeddings, memories
               ├─▶ Ollama on the host (:11434)   chat + embeddings  [local mode]
               ├─▶ Anthropic API                 chat               [smart mode]
               └─▶ ComfyUI (:8188)               image generation
```

Ollama runs on the **host**, not in a container, so the chat model and the image
model share one GPU and one model cache instead of fighting over two.

| Layer | Choice |
|---|---|
| UI + API | Next.js 16, React 19, TypeScript, Tailwind 4 |
| Database | Postgres 17 + pgvector, Drizzle ORM |
| Auth | bcrypt + JWT in an httpOnly cookie |
| Documents | `unpdf` (PDF), `mammoth` (DOCX) |
| Ops tooling | Python (`scripts/`) |

---

## Layout

```
├── docker-compose.yml
├── requirements.txt        Python ops dependencies
├── scripts/                init_env, bootstrap, healthcheck, backup
├── comfy/                  image-generation container + model files
├── db/init/                Postgres extensions
├── data/                   volumes: postgres, uploads, images (gitignored)
└── web/                    the Next.js application
    └── src/
        ├── app/            pages + API routes
        ├── components/     chat UI, login, admin
        ├── lib/            auth, safety, rag, memory, ai/
        └── db/             schema + migrations
```

---

## Troubleshooting

**"Ollama is not reachable"** — run `ollama serve` on the host, then
`python -m scripts.healthcheck`.

**Embedding errors on upload** — `ollama pull nomic-embed-text`.

**Image generation fails** — confirm the checkpoint is in
`comfy/models/checkpoints/` and that the `images` profile is up.

**Slow replies** — `gpt-oss:20b` is 13.8GB and will not fit in 8GB of VRAM; it
spills to CPU. Stick with `gemma3` for chat and set `OLLAMA_CHAT_MODEL` in `.env`.
