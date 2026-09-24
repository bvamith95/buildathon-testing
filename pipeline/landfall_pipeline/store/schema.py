"""Data model matching docs/architecture.md §7 (ER diagram) and
docs/prd.md's "Data model and analytics" section.

STEP.id is stable and author-assigned (never derived from position) — see
docs/architecture.md §7 and the CLAUDE.md architectural constraints. Every
model here is the pipeline's write side; the Next.js app reads the same
JSON shape from the published guide files.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

StepState = Literal["verified", "stale", "no_source", "not_specific"]
ProgramLevel = Literal["graduate", "undergraduate"]


class Source(BaseModel):
    organisation: str
    title: str
    url: str
    last_verified: date | None = None
    """None means the source has never been confirmed unchanged — a failed
    crawl must not advance this date (docs/decisions.md, item 4)."""


class Office(BaseModel):
    name: str
    note: str | None = None


class WhereToDo(BaseModel):
    label: str
    host: str
    url: str


class Step(BaseModel):
    id: str
    """Stable, author-assigned. Never derived from list position."""
    phase: str
    offset_days: int
    title: str
    why: str
    prerequisites: list[str] = Field(default_factory=list)
    cost: str | None = None
    time_estimate: str | None = None
    where: WhereToDo
    office: Office | None = None
    sources: list[Source] = Field(default_factory=list)
    applies_to_rules: list[str] = Field(default_factory=list)
    confidence: float
    state: StepState


class BucketSignature(BaseModel):
    """The 5-tuple from docs/architecture.md §5. Order is fixed so the
    same combination always serializes to the same signature string."""

    entry_document: Literal["eta", "visa_required"]
    biometrics: Literal["required", "exempt"]
    medical_exam: Literal["required", "not_required"]
    funds_evidence: Literal["standard", "country_programme_variant"]
    currency_corridor: Literal["major", "restricted"]

    def signature(self) -> str:
        return "-".join(
            [
                self.entry_document,
                self.biometrics,
                self.medical_exam,
                self.funds_evidence,
                self.currency_corridor,
            ]
        )


class Guide(BaseModel):
    content_version: int
    program_level: ProgramLevel
    bucket_signature: str
    steps: list[Step]
    generated_at: datetime
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None

    def cache_key(self) -> str:
        """Guides are keyed on (bucket_signature, program_level) only —
        never on an individual user or on arrival_date (CLAUDE.md)."""
        return f"{self.bucket_signature}__{self.program_level}"
