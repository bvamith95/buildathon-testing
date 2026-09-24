"""Diff engine: compares a newly generated variant against the previously
published version of the same (bucket_signature, program_level), step by
step, keyed on the stable Step.id — never on list position."""

from __future__ import annotations

from dataclasses import dataclass

from landfall_pipeline.store.schema import Guide, Step


@dataclass
class StepDiff:
    step_id: str
    kind: str  # "added" | "removed" | "changed" | "unchanged"
    previous: Step | None
    current: Step | None


def diff_guides(previous: Guide | None, current: Guide) -> list[StepDiff]:
    previous_steps: dict[str, Step] = {s.id: s for s in previous.steps} if previous else {}
    current_steps: dict[str, Step] = {s.id: s for s in current.steps}

    diffs: list[StepDiff] = []

    for step_id, step in current_steps.items():
        prior = previous_steps.get(step_id)
        if prior is None:
            diffs.append(StepDiff(step_id, "added", None, step))
        elif prior.model_dump(exclude={"confidence"}) != step.model_dump(exclude={"confidence"}):
            diffs.append(StepDiff(step_id, "changed", prior, step))
        else:
            diffs.append(StepDiff(step_id, "unchanged", prior, step))

    for step_id, step in previous_steps.items():
        if step_id not in current_steps:
            diffs.append(StepDiff(step_id, "removed", step, None))

    return diffs


def changed_only(diffs: list[StepDiff]) -> list[StepDiff]:
    """Feeds the review queue — only changed/added/removed steps need a
    human look (docs/prd.md: "Human review, changed steps only")."""
    return [d for d in diffs if d.kind != "unchanged"]
