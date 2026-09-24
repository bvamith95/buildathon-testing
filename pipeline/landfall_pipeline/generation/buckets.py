"""Bucket taxonomy, frozen per docs/decisions.md.

Citizenship resolves into independent rule buckets rather than being
treated as one 190-value variable (docs/prd.md, "Personalisation model").
The actual per-country -> bucket mapping is content knowledge that belongs
to the Week 1 pilot bucket, not hardcoded logic — this module only defines
the taxonomy shape and the realistic combinations to generate against.
"""

from __future__ import annotations

from landfall_pipeline.store.schema import BucketSignature

# The "roughly six realistic combinations" from docs/prd.md — to be
# finalized during the Week 1 taxonomy freeze / pilot bucket run
# (docs/implementation-plan.md Week 1). This is a starting placeholder,
# not the frozen list.
REALISTIC_COMBINATIONS: list[BucketSignature] = [
    BucketSignature(
        entry_document="eta",
        biometrics="exempt",
        medical_exam="not_required",
        funds_evidence="standard",
        currency_corridor="major",
    ),
    BucketSignature(
        entry_document="visa_required",
        biometrics="required",
        medical_exam="required",
        funds_evidence="country_programme_variant",
        currency_corridor="restricted",
    ),
]


def known_signatures() -> set[str]:
    return {combo.signature() for combo in REALISTIC_COMBINATIONS}


def is_covered(signature: BucketSignature) -> bool:
    """False means: per docs/decisions.md, this is a taxonomy-coverage gap
    to route through the generation pipeline for expansion — not a
    permanent "closest match" fallback. The Next.js app's guide-level
    unmatched-signature state (still an open decision, see
    docs/architecture.md "Still open") handles the interim rendering."""
    return signature.signature() in known_signatures()
