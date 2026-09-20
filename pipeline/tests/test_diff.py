from datetime import datetime, timezone

from landfall_pipeline.review.diff import changed_only, diff_guides
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


def test_diff_detects_added_changed_removed_unchanged():
    previous = make_guide([make_step("a", "Apply for SIN"), make_step("b", "Book biometrics")], version=1)
    current = make_guide(
        [make_step("a", "Apply for SIN"), make_step("b", "Book biometrics appointment"), make_step("c", "New step")],
        version=2,
    )

    diffs = diff_guides(previous, current)
    by_id = {d.step_id: d.kind for d in diffs}

    assert by_id["a"] == "unchanged"
    assert by_id["b"] == "changed"
    assert by_id["c"] == "added"

    only_changed = changed_only(diffs)
    assert {d.step_id for d in only_changed} == {"b", "c"}


def test_diff_against_no_previous_guide_marks_everything_added():
    current = make_guide([make_step("a", "Apply for SIN")], version=1)
    diffs = diff_guides(None, current)
    assert len(diffs) == 1
    assert diffs[0].kind == "added"
