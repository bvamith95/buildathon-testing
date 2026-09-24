"""Apply the product owner's review decisions from run_pilot.py's output
and publish. Every step is approved by default; pass step IDs to
--reject to revert specific ones (there's no "previous" version for a
first pilot run, so a rejected step is simply dropped, per
docs/decisions.md's per-step revert rule).

Usage:
  python apply_pilot_review.py                          # approve everything
  python apply_pilot_review.py --reject apply-for-msp    # reject one step
"""

from __future__ import annotations

import argparse
import sys

import json
from datetime import datetime, timezone

from landfall_pipeline.review.diff import diff_guides
from landfall_pipeline.review.queue import QUEUE_PATH
from landfall_pipeline.store.publish import apply_review, load_previous_guide, next_content_version, write_guide
from landfall_pipeline.store.schema import Guide
from run_pilot import PILOT_BUCKET, PILOT_PROGRAM_LEVEL


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reject", nargs="*", default=[], help="Step IDs to reject")
    parser.add_argument("--reviewed-by", default="product-owner", help="Name recorded as reviewer")
    args = parser.parse_args()

    with open(QUEUE_PATH) as f:
        queue = json.load(f)

    current = Guide.model_validate(
        {
            "content_version": 1,
            "program_level": PILOT_PROGRAM_LEVEL,
            "bucket_signature": PILOT_BUCKET.signature(),
            "steps": [row["current"] for row in queue if row["current"]],
            "generated_at": datetime.now(timezone.utc),
        }
    )

    previous = load_previous_guide(current.cache_key())
    diffs = diff_guides(previous, current)

    decisions = {row["step_id"]: ("rejected" if row["step_id"] in args.reject else "approved") for row in queue}

    published = apply_review(current, diffs, decisions, reviewed_by=args.reviewed_by)
    published = published.model_copy(update={"content_version": next_content_version(previous)})

    path = write_guide(published)
    print(f"Published {len(published.steps)} steps to {path}")
    print(f"content_version={published.content_version}, reviewed_by={published.reviewed_by}")
    if args.reject:
        print(f"Rejected and dropped: {args.reject}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
