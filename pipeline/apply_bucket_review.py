"""Apply the product owner's review decisions from generate_bucket.py's
output and publish. Mirrors apply_pilot_review.py's per-step revert rule,
generalized to any bucket/level queue file.

Usage:
  python apply_bucket_review.py --queue pipeline/data/review_queue__eta-exempt-not_required-standard-major__graduate.json
  python apply_bucket_review.py --queue ... --reject apply-for-msp
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

from landfall_pipeline.review.diff import diff_guides
from landfall_pipeline.store.publish import apply_review, load_previous_guide, next_content_version, write_guide
from landfall_pipeline.store.schema import Guide


def publish_queue(queue_path: str, reject: list[str] | None = None, reviewed_by: str = "product-owner") -> str:
    reject = reject or []
    with open(queue_path) as f:
        queue = json.load(f)

    current_steps = [row["current"] for row in queue if row["current"]]
    if not current_steps:
        raise RuntimeError(f"{queue_path} has no current steps to publish.")

    # The queue file itself doesn't carry bucket_signature/program_level
    # (steps don't either) — recover both from the filename, which
    # generate_bucket.py names review_queue__<signature>__<level>.json.
    stem = queue_path.rsplit("review_queue__", 1)[-1].rsplit(".json", 1)[0]
    bucket_signature, program_level = stem.rsplit("__", 1)

    current = Guide.model_validate(
        {
            "content_version": 1,
            "program_level": program_level,
            "bucket_signature": bucket_signature,
            "steps": current_steps,
            "generated_at": datetime.now(timezone.utc),
        }
    )

    previous = load_previous_guide(current.cache_key())
    diffs = diff_guides(previous, current)

    decisions = {row["step_id"]: ("rejected" if row["step_id"] in reject else "approved") for row in queue}

    published = apply_review(current, diffs, decisions, reviewed_by=reviewed_by)
    published = published.model_copy(update={"content_version": next_content_version(previous)})

    return write_guide(published)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--queue", required=True, help="Path to a review queue JSON file")
    parser.add_argument("--reject", nargs="*", default=[], help="Step IDs to reject")
    parser.add_argument("--reviewed-by", default="product-owner", help="Name recorded as reviewer")
    args = parser.parse_args()

    path = publish_queue(args.queue, reject=args.reject, reviewed_by=args.reviewed_by)
    print(f"Published to {path}")
    if args.reject:
        print(f"Rejected and dropped: {args.reject}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
