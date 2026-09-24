"""Generate one bucket variant against the already-crawled, cached
retrieval index (run_pilot.py builds that index the first time; this
script never re-crawls or re-embeds documents).

Which steps exist and what each one covers comes from
landfall_pipeline.generation.step_plans.build_step_plan, derived from
docs/prd.md's bucket table — e.g. a biometrics-exempt bucket simply has no
biometrics step, rather than an empty/placeholder one.

Writes a review queue for this specific (bucket, level) pair; nothing is
published until apply_bucket_review.py runs against that queue file
(docs/decisions.md, "Review-gate rejection behavior").

Usage:
  python generate_bucket.py --entry-document eta --biometrics exempt \\
      --medical-exam not_required --funds-evidence standard \\
      --currency-corridor major --level graduate
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone

from landfall_pipeline.config import DATA_DIR
from landfall_pipeline.generation.embeddings import EmbeddingClient
from landfall_pipeline.generation.generator import StepGenerator
from landfall_pipeline.generation.retrieval_index import RetrievalIndex
from landfall_pipeline.generation.step_plans import build_step_plan
from landfall_pipeline.review.diff import diff_guides
from landfall_pipeline.review.queue import write_queue
from landfall_pipeline.store.publish import load_previous_guide
from landfall_pipeline.store.schema import BucketSignature, Guide


def queue_path(cache_key: str) -> str:
    return os.path.join(DATA_DIR, f"review_queue__{cache_key}.json")


def generate_bucket(bucket: BucketSignature, level: str) -> None:
    cache_key = f"{bucket.signature()}__{level}"
    print(f"Bucket signature: {bucket.signature()}")
    print(f"Program level: {level}")

    index = RetrievalIndex.load()
    if not index._items:
        print("No cached retrieval index found — run run_pilot.py first to crawl and embed.")
        sys.exit(1)
    print(f"Loaded {len(index._items)} cached chunks (no re-crawl, no re-embed of documents).")

    plan = build_step_plan(bucket, level)
    print(f"\nGenerating {len(plan)} steps (Claude Opus 5)...")
    embeddings_client = EmbeddingClient()
    generator = StepGenerator(index=index, embeddings=embeddings_client)
    steps = []
    for i, (step_id, phase, offset_days, claim_prompt) in enumerate(plan):
        if i > 0:
            time.sleep(21)  # each step embeds a query via Voyage — same free-tier rate limit
        for attempt in range(3):
            try:
                step = generator.generate_step(step_id, phase, offset_days, claim_prompt)
                break
            except Exception as exc:
                if attempt == 2:
                    raise
                print(f"  {step_id} failed ({exc}); backing off 30s and retrying")
                time.sleep(30)
        print(f"  [{step.state}] {step_id}: {step.title!r} (confidence={step.confidence:.2f})")
        steps.append(step)

    guide = Guide(
        content_version=1,
        program_level=level,
        bucket_signature=bucket.signature(),
        steps=steps,
        generated_at=datetime.now(timezone.utc),
    )
    previous = load_previous_guide(guide.cache_key())
    diffs = diff_guides(previous, guide)
    path = queue_path(cache_key)
    write_queue(diffs, path=path)
    print(f"\nReview queue written to {path} ({len(diffs)} steps to review).")
    print(f"Nothing has been published. Run:\n  python apply_bucket_review.py --queue {path}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--entry-document", choices=["eta", "visa_required"], required=True)
    parser.add_argument("--biometrics", choices=["required", "exempt"], required=True)
    parser.add_argument("--medical-exam", choices=["required", "not_required"], required=True)
    parser.add_argument("--funds-evidence", choices=["standard", "country_programme_variant"], required=True)
    parser.add_argument("--currency-corridor", choices=["major", "restricted"], required=True)
    parser.add_argument("--level", choices=["graduate", "undergraduate"], required=True)
    args = parser.parse_args()

    bucket = BucketSignature(
        entry_document=args.entry_document,
        biometrics=args.biometrics,
        medical_exam=args.medical_exam,
        funds_evidence=args.funds_evidence,
        currency_corridor=args.currency_corridor,
    )
    generate_bucket(bucket, args.level)
    return 0


if __name__ == "__main__":
    sys.exit(main())
