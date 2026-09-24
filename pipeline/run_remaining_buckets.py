"""Batch-generate and publish every remaining (bucket, level) combination
from the frozen taxonomy (docs/decisions.md item 15) that isn't already
published under apps/web/public/guides/.

The product owner reviewed one checkpoint bucket's actual generated
content by hand (eta-exempt-not_required-standard-major, graduate) before
authorizing this batch to run unattended — see the session record. Every
step still goes through the same honesty guarantees as that checkpoint
(no citation, no claim; no_source ships instead of a fabrication), so this
script auto-approves every generated step rather than pausing per bucket.

Usage: python run_remaining_buckets.py
"""

from __future__ import annotations

import os
import sys

from apply_bucket_review import publish_queue
from generate_bucket import generate_bucket, queue_path
from landfall_pipeline.config import GUIDE_OUTPUT_DIR
from landfall_pipeline.generation.buckets import REALISTIC_COMBINATIONS
from landfall_pipeline.store.schema import ProgramLevel

LEVELS: list[ProgramLevel] = ["graduate", "undergraduate"]


def already_published(cache_key: str) -> bool:
    return os.path.exists(os.path.join(GUIDE_OUTPUT_DIR, f"{cache_key}.json"))


def main() -> int:
    combos = [(bucket, level) for bucket in REALISTIC_COMBINATIONS for level in LEVELS]
    todo = [(b, l) for b, l in combos if not already_published(f"{b.signature()}__{l}")]

    print(f"{len(combos)} total (bucket, level) combinations; {len(todo)} remaining to generate.\n")

    results = []
    for i, (bucket, level) in enumerate(todo):
        cache_key = f"{bucket.signature()}__{level}"
        print(f"[{i + 1}/{len(todo)}] {cache_key}")
        try:
            generate_bucket(bucket, level)
            path = publish_queue(queue_path(cache_key))
            print(f"  Published: {path}\n")
            results.append((cache_key, "published"))
        except Exception as exc:
            print(f"  FAILED: {exc}\n")
            results.append((cache_key, f"failed: {exc}"))

    print("\nSummary:")
    for cache_key, status in results:
        print(f"  {cache_key}: {status}")

    failures = [r for r in results if r[1] != "published"]
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
