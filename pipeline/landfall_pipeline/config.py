"""Environment configuration for the pipeline.

No defaults or fallbacks on secrets: a missing key must fail loudly at
startup, not silently degrade generation (see docs/architecture.md's
content-integrity rules).
"""

import os

from dotenv import load_dotenv

load_dotenv()


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"{name} is not set. Copy pipeline/.env.example to pipeline/.env "
            f"and fill it in before running the pipeline."
        )
    return value


def anthropic_api_key() -> str:
    return _require("ANTHROPIC_API_KEY")


def voyage_api_key() -> str:
    return _require("VOYAGE_API_KEY")


# Model for generation. Overridable via env for local cost testing, but the
# reviewed-and-decided default (docs/decisions.md) is Claude Opus 5.
GENERATION_MODEL = os.environ.get("LANDFALL_GENERATION_MODEL", "claude-opus-5")
EMBEDDING_MODEL = os.environ.get("LANDFALL_EMBEDDING_MODEL", "voyage-3")

# Consecutive crawl failures on one source before alerting the review owner
# (docs/decisions.md, "Crawl failure alerting").
CRAWL_FAILURE_ALERT_THRESHOLD = 3

# Recheck window in days before a step's source counts as stale
# (docs/decisions.md, "Set the recheck window").
RECHECK_WINDOW_DAYS = {
    "immigration": 30,
    "default": 90,
}

# Cap on steps per guide (docs/decisions.md, "Cap the step count").
MAX_STEPS_PER_GUIDE = 20

DATA_DIR = os.environ.get(
    "LANDFALL_DATA_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"),
)

# Where published guide JSON is written for the Next.js app to serve as
# static assets (docs/decisions.md: static JSON via Vercel + Next.js).
GUIDE_OUTPUT_DIR = os.environ.get(
    "LANDFALL_GUIDE_OUTPUT_DIR",
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "apps",
        "web",
        "public",
        "guides",
    ),
)
