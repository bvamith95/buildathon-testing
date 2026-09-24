# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

Two code trees exist alongside the planning docs, per `docs/decisions.md` and `docs/implementation-plan.md`:

- `apps/web/` — the Next.js (TypeScript, App Router, Tailwind) client. Scaffolded, no product screens built yet.
- `pipeline/` — the Python content pipeline (crawler, chunker, RAG generation via Claude Opus 5, review/diff, publish). Schema, diff engine, chunker, and publish logic are implemented and tested; crawler/generation modules need real API credentials and a confirmed whitelist to run end to end (see `pipeline/landfall_pipeline/crawler/whitelist.py`).

### Commands

**Client (`apps/web/`):**
```bash
npm install        # first time only
npm run dev         # local dev server
npm run build        # production build
npm run lint         # eslint
```

**Pipeline (`pipeline/`):**
```bash
python3 -m venv .venv && source .venv/bin/activate   # first time only
pip install -r requirements.txt
cp .env.example .env   # then fill in ANTHROPIC_API_KEY, VOYAGE_API_KEY

pytest                          # run all tests
pytest tests/test_diff.py       # single file
pytest tests/test_diff.py::test_diff_detects_added_changed_removed_unchanged  # single test
```
Pipeline tests cover pure-logic modules only (schema, diff, chunker, publish) — no external API calls, no credentials needed to run them.

Both `.env.example` files (`apps/web/.env.example`, `pipeline/.env.example`) list the required environment variables. Never commit a real `.env`/`.env.local` — both are gitignored.

## What's here

All content lives under `docs/`, documenting the "Landfall" product (a personalised, source-cited onboarding checklist for admitted UBC international students, covering immigration and money tasks from offer acceptance to day 30 in Vancouver):

- `docs/prd.md` — the product requirements document: problem, users, scope, success metrics, screens, personalisation model, content states, data model, non-functional requirements, and the 4-week build plan.
- `docs/architecture.md` — the technical architecture: system context, containers, offline content-pipeline sequence, online request-path sequence, bucket-resolution logic, client state-resolution logic, data model (ER diagram), and deployment shape.
- `docs/decisions.md` — the decision log. Every open decision from `prd.md` and every blocking/important item raised in review has a resolution recorded here, dated and attributed. Two items remain open (see "Still open" at the end of that file): the product name, and the interim rendering behavior for a bucket signature observed before it's added to the pre-generated set.
- `docs/prd-review.md` — a review of the PRD, annotated with resolutions pointing back to `decisions.md`.
- `docs/implementation-plan.md` — the 4-week build broken into four parallel workstreams (Pipeline, Client, Data/Analytics, Product ops) with per-week task checklists and a Gantt-style sequencing diagram.

When asked to work on this product, treat `docs/decisions.md` as authoritative over anything superseded in `prd.md` or `architecture.md` — those two are annotated but not rewritten wholesale, so a resolved item may still show its original open-question framing inline with a note pointing at the resolution.

## Architectural constraints that any implementation must preserve

These are decisions already made (`docs/architecture.md`, `docs/decisions.md`) that shape any future code in this repo. Getting them wrong defeats the reason the architecture looks the way it does:

- **Guides are looked up, not generated, at request time.** An offline nightly pipeline (crawl → chunk → generate via RAG → diff → human review → publish) produces a small set of pre-generated variants. The online request path is a cache read keyed on `(bucket_signature, program_level)` — never on an individual user or on `arrival_date`, and never involves an LLM call. This is what makes the sub-2-second time-to-value target and the human review gate both possible; live per-request generation was explicitly rejected.
- **`arrival_date` never enters the cache key.** Steps store an integer `offset_days`; real dates are computed client-side as `arrival_date + offset_days`. This is the only way one cached guide can serve every student in a bucket regardless of when they fly.
- **No generated claim ships without a citation.** A step that can't clear the confidence threshold (embedding similarity to its best-matching retrieved chunk, per-bucket cutoff tuned after a pilot run) ships in a `no_source` state — title, date, official link, one line, no generated prose. There is no fallback to the model's own knowledge anywhere in the pipeline.
- **The whitelist is enforced at ingestion, not generation.** Only four domains (UBC, IRCC, BC, and canada.ca for both Service Canada and CRA content) are ever crawled; a chunk without full provenance (`url`, `title`, `organisation`, `fetched_at`) is discarded before it can be used. Note: SIN-application pages are published by Service Canada, not CRA — `pipeline/landfall_pipeline/crawler/whitelist.py` tags each page's `organisation` with the actual publisher, not a blanket "CRA" label, so citations shown to users stay accurate.
- **A failed crawl never silently advances a source's `last_verified` date.** Staleness (recheck window: 30 days for immigration content, 90 for the rest) must reflect "confirmed unchanged," not "we didn't check." Three consecutive failed crawls on a source alert the review owner.
- **`STEP.id` is a stable, author-assigned identifier, never derived from array position.** Returning users' checkbox state (now three-valued: done / not done / not applicable) is keyed on it in `localStorage`; a content update that reshuffles steps must not silently untick or misapply the wrong step for existing users.
- **Client profile state resolves in a fixed order: URL params → `localStorage` → fresh start.** Profile lives in the URL (e.g. `/guide?c=IN&d=2026-08-25&l=grad`) so a shared link always builds the recipient their own guide from that URL, not the sender's saved progress — even when the recipient has an unrelated profile already in their own `localStorage`.
- **`profile_hash` in feedback events is salted per `session_id`**, not a bare hash of profile fields, so it can't be matched across sessions or against the plain profile parameters visible in a shared URL.
- **Each publish bumps a monotonic `content_version`**, stored on every feedback event and every returning user's last-seen state — this is what makes the change banner and any regression analysis (did a rating drop come from content or from audience) possible.
- **Housing content is deliberately out of the citation/whitelist pipeline.** The two housing pointer links (UBC housing site, UBC Facebook roommates group) are manually maintained by the product owner, not crawled or reviewed like everything else — don't route them through the pipeline machinery.
