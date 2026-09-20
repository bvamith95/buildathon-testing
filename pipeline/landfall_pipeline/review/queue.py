"""Minimal review queue: writes changed steps to a JSON file the review
owner reads, and records per-step approve/reject decisions.

A real review UI (docs/implementation-plan.md Week 1, "Review queue UI")
can replace the file-based interaction later without changing the
decision contract below.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Literal

from landfall_pipeline.config import DATA_DIR
from landfall_pipeline.review.diff import StepDiff

QUEUE_PATH = os.path.join(DATA_DIR, "review_queue.json")

Decision = Literal["approved", "rejected"]


@dataclass
class ReviewDecision:
    step_id: str
    decision: Decision
    reviewed_by: str


def write_queue(diffs: list[StepDiff], path: str = QUEUE_PATH) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = [
        {
            "step_id": d.step_id,
            "kind": d.kind,
            "current": d.current.model_dump(mode="json") if d.current else None,
            "previous": d.previous.model_dump(mode="json") if d.previous else None,
        }
        for d in diffs
    ]
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)


def read_decisions(path: str) -> list[ReviewDecision]:
    """path points to a decisions file the reviewer produces alongside the
    queue — shape: [{"step_id": ..., "decision": "approved"|"rejected",
    "reviewed_by": ...}, ...]."""
    with open(path) as f:
        raw = json.load(f)
    return [ReviewDecision(**row) for row in raw]
