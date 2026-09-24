"""Regenerate a single step across one or more already-published guides
and republish, without touching the rest of the guide's steps.

For fixing a step whose claim_prompt was reworded in step_plans.py after
publishing — e.g. because retrieval was landing on the wrong chunk for the
old wording, not because the source was actually missing (see
docs/decisions.md item 17). Cheaper than re-running the whole bucket
through generate_bucket.py when only one step needs a new query.

Usage:
  python patch_step.py --step-id apply-for-sin \\
      --cache-key visa_required-required-required-country_programme_variant-restricted__graduate \\
      --cache-key eta-exempt-not_required-standard-major__graduate
"""

from __future__ import annotations

import argparse
import sys
import time

from landfall_pipeline.generation.embeddings import EmbeddingClient
from landfall_pipeline.generation.generator import StepGenerator
from landfall_pipeline.generation.retrieval_index import RetrievalIndex
from landfall_pipeline.generation.step_plans import build_step_plan
from landfall_pipeline.review.diff import diff_guides
from landfall_pipeline.store.publish import apply_review, load_previous_guide, next_content_version, write_guide
from landfall_pipeline.store.schema import BucketSignature


def patch_one(cache_key: str, step_id: str, generator: StepGenerator) -> None:
    signature_str, level = cache_key.rsplit("__", 1)
    previous = load_previous_guide(cache_key)
    if previous is None:
        print(f"  {cache_key}: no published guide found, skipping")
        return

    bucket = BucketSignature(**dict(zip(
        ["entry_document", "biometrics", "medical_exam", "funds_evidence", "currency_corridor"],
        signature_str.split("-"),
    )))
    plan = {entry[0]: entry for entry in build_step_plan(bucket, level)}
    if step_id not in plan:
        print(f"  {cache_key}: {step_id} doesn't apply to this bucket, skipping")
        return
    _, phase, offset_days, claim_prompt = plan[step_id]

    new_step = generator.generate_step(step_id, phase, offset_days, claim_prompt)
    print(f"  {cache_key}: [{new_step.state}] {new_step.title!r} (confidence={new_step.confidence:.2f})")

    current_steps = {s.id: s for s in previous.steps}
    current_steps[step_id] = new_step
    current = previous.model_copy(update={"steps": list(current_steps.values())})

    diffs = diff_guides(previous, current)
    decisions = {d.step_id: "approved" for d in diffs}
    published = apply_review(current, diffs, decisions, reviewed_by="product-owner")
    published = published.model_copy(update={"content_version": next_content_version(previous)})
    path = write_guide(published)
    print(f"    published content_version={published.content_version} -> {path}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--step-id", required=True)
    parser.add_argument("--cache-key", action="append", required=True, dest="cache_keys")
    args = parser.parse_args()

    index = RetrievalIndex.load()
    if not index._items:
        print("No cached retrieval index found.")
        return 1
    embeddings_client = EmbeddingClient()
    generator = StepGenerator(index=index, embeddings=embeddings_client)

    for i, cache_key in enumerate(args.cache_keys):
        if i > 0:
            time.sleep(21)
        patch_one(cache_key, args.step_id, generator)
    return 0


if __name__ == "__main__":
    sys.exit(main())
