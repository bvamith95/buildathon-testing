from datetime import datetime, timezone

from landfall_pipeline.review.diff import diff_guides
from landfall_pipeline.store.publish import apply_review, next_content_version
from landfall_pipeline.store.schema import Guide, Step, WhereToDo


def make_step(step_id: str, title: str) -> Step:
    return Step(
        id=step_id,
        phase="after_offer",
        offset_days=-60,
        title=title,
        why="because",
        where=WhereToDo(label="x", host="x.com", url="https://x.com"),
        confidence=0.9,
        state="verified",
    )


def make_guide(steps: list[Step], version: int) -> Guide:
    return Guide(
        content_version=version,
        program_level="graduate",
        bucket_signature="sig",
        steps=steps,
        generated_at=datetime.now(timezone.utc),
    )


def test_rejected_step_reverts_others_still_publish():
    previous = make_guide([make_step("a", "Old title A"), make_step("b", "Old title B")], version=1)
    current = make_guide([make_step("a", "New title A"), make_step("b", "New title B")], version=2)

    diffs = diff_guides(previous, current)
    # Reject the change to "a", approve "b".
    decisions = {"a": "rejected", "b": "approved"}

    published = apply_review(current, diffs, decisions, reviewed_by="owner")

    titles = {s.id: s.title for s in published.steps}
    assert titles["a"] == "Old title A"  # reverted
    assert titles["b"] == "New title B"  # still publishes


def test_rejected_new_step_is_dropped_not_published():
    previous = make_guide([make_step("a", "Title A")], version=1)
    current = make_guide([make_step("a", "Title A"), make_step("new", "Brand new step")], version=2)

    diffs = diff_guides(previous, current)
    decisions = {"new": "rejected"}

    published = apply_review(current, diffs, decisions, reviewed_by="owner")

    assert {s.id for s in published.steps} == {"a"}


def test_next_content_version_starts_at_one_and_increments():
    assert next_content_version(None) == 1
    guide = make_guide([make_step("a", "Title A")], version=5)
    assert next_content_version(guide) == 6
