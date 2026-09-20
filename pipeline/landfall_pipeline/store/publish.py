"""Publish service: applies review decisions with per-step revert
(docs/decisions.md, item 2), bumps content_version, and writes the guide
as static JSON for the Next.js app to serve (docs/decisions.md: "Static
JSON files served via Vercel + Next.js").
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from landfall_pipeline.config import GUIDE_OUTPUT_DIR
from landfall_pipeline.review.diff import StepDiff
from landfall_pipeline.review.queue import Decision
from landfall_pipeline.store.schema import Guide


def apply_review(
    current: Guide,
    diffs: list[StepDiff],
    decisions: dict[str, Decision],
    reviewed_by: str,
) -> Guide:
    """A rejected step reverts to its last-published content; every other
    approved step still publishes under the new content_version — never a
    whole-variant or whole-run hold on one rejected step."""
    steps_by_id = {s.id: s for s in current.steps}

    for diff in diffs:
        decision = decisions.get(diff.step_id)
        if decision == "rejected" and diff.previous is not None:
            steps_by_id[diff.step_id] = diff.previous
        elif decision == "rejected" and diff.previous is None:
            # A rejected brand-new step has nothing to revert to — drop it.
            steps_by_id.pop(diff.step_id, None)

    return current.model_copy(
        update={
            "steps": list(steps_by_id.values()),
            "reviewed_by": reviewed_by,
            "reviewed_at": datetime.now(timezone.utc),
        }
    )


def next_content_version(previous: Guide | None) -> int:
    return (previous.content_version + 1) if previous else 1


def write_guide(guide: Guide, output_dir: str = GUIDE_OUTPUT_DIR) -> str:
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, f"{guide.cache_key()}.json")
    with open(path, "w") as f:
        json.dump(guide.model_dump(mode="json"), f, indent=2)
    return path


def load_previous_guide(cache_key: str, output_dir: str = GUIDE_OUTPUT_DIR) -> Guide | None:
    path = os.path.join(output_dir, f"{cache_key}.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return Guide.model_validate(json.load(f))
