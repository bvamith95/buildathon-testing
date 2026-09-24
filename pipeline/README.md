# Una content pipeline

The offline half of the architecture in `../docs/architecture.md` §2–§3:
crawl the whitelist → chunk with provenance → embed → generate via RAG →
diff against the previous published version → human review → publish as
static guide JSON that `apps/web` serves.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # then fill in ANTHROPIC_API_KEY and VOYAGE_API_KEY
```

## Run tests

```bash
source .venv/bin/activate
pytest
```

Tests cover the pure-logic modules (schema, diff, chunker, publish) and
don't call any external API. Crawler/embedding/generation modules need
real credentials and a confirmed whitelist to exercise end to end — see
`landfall_pipeline/crawler/whitelist.py`'s TODO and
`../docs/implementation-plan.md` Week 1.

## Layout

- `landfall_pipeline/crawler/` — whitelist enforcement, fetching, crawl-failure tracking
- `landfall_pipeline/generation/` — chunking, embeddings, the local retrieval index, bucket taxonomy, RAG generation
- `landfall_pipeline/review/` — diff engine, review queue
- `landfall_pipeline/store/` — the Guide/Step/Source schema, publish (per-step revert, versioning, writing static JSON)

Architectural constraints this code must preserve are listed in `../CLAUDE.md`.
