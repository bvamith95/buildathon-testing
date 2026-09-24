"""Re-run only the generation stage of the pilot against the cached
retrieval index — used after tuning DEFAULT_CONFIDENCE_THRESHOLD so we
don't re-crawl or re-embed 136 chunks for a threshold change.

Usage: python regenerate_pilot_steps.py
"""

from __future__ import annotations

import sys

from landfall_pipeline.generation.embeddings import EmbeddingClient
from landfall_pipeline.generation.retrieval_index import RetrievalIndex
from run_pilot import diff_and_queue, generate_all_steps


def main() -> int:
    index = RetrievalIndex.load()
    if not index._items:
        print("No cached index found — run run_pilot.py first.")
        return 1
    print(f"Loaded {len(index._items)} cached chunks (no re-crawl, no re-embed of documents).")

    embeddings_client = EmbeddingClient()
    steps = generate_all_steps(index, embeddings_client)
    diff_and_queue(steps)
    return 0


if __name__ == "__main__":
    sys.exit(main())
