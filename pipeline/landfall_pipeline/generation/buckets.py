"""Bucket taxonomy, frozen per docs/decisions.md.

Citizenship resolves into independent rule buckets rather than being
treated as one 190-value variable (docs/prd.md, "Personalisation model").
The actual per-country -> bucket mapping is content knowledge that belongs
to the Week 1 pilot bucket, not hardcoded logic — this module only defines
the taxonomy shape and the realistic combinations to generate against.

Frozen 2026-09-24 (docs/decisions.md item 15) at 7 signatures — one more
than the PRD's rough "six realistic combinations" — derived directly from
real IRCC eTA/biometrics/medical-exam data researched for 21 citizenships
(the same table backing apps/web/src/lib/buckets.ts's client-side lookup;
keep the two in sync). #1 is the Week 1 pilot bucket, already published.
"""

from __future__ import annotations

from landfall_pipeline.store.schema import BucketSignature

REALISTIC_COMBINATIONS: list[BucketSignature] = [
    # 1. China, India, Nigeria, Vietnam, Bangladesh, Pakistan, Philippines,
    #    Indonesia. Already published (Week 1 pilot).
    BucketSignature(
        entry_document="visa_required",
        biometrics="required",
        medical_exam="required",
        funds_evidence="country_programme_variant",
        currency_corridor="restricted",
    ),
    # 2. United States.
    BucketSignature(
        entry_document="eta",
        biometrics="exempt",
        medical_exam="not_required",
        funds_evidence="standard",
        currency_corridor="major",
    ),
    # 3. Iran.
    BucketSignature(
        entry_document="visa_required",
        biometrics="required",
        medical_exam="not_required",
        funds_evidence="country_programme_variant",
        currency_corridor="restricted",
    ),
    # 4. South Korea, Hong Kong.
    BucketSignature(
        entry_document="eta",
        biometrics="required",
        medical_exam="required",
        funds_evidence="standard",
        currency_corridor="major",
    ),
    # 5. France, Japan, United Kingdom, Germany, Taiwan, Australia.
    BucketSignature(
        entry_document="eta",
        biometrics="required",
        medical_exam="not_required",
        funds_evidence="standard",
        currency_corridor="major",
    ),
    # 6. Mexico, Saudi Arabia.
    BucketSignature(
        entry_document="visa_required",
        biometrics="required",
        medical_exam="not_required",
        funds_evidence="standard",
        currency_corridor="major",
    ),
    # 7. Brazil.
    BucketSignature(
        entry_document="visa_required",
        biometrics="required",
        medical_exam="required",
        funds_evidence="standard",
        currency_corridor="major",
    ),
]


def known_signatures() -> set[str]:
    return {combo.signature() for combo in REALISTIC_COMBINATIONS}


def is_covered(signature: BucketSignature) -> bool:
    """False means: per docs/decisions.md, this is a taxonomy-coverage gap
    to route through the generation pipeline for expansion — not a
    permanent "closest match" fallback. The Next.js app's guide-level
    unmatched-signature state (docs/decisions.md item 14, apps/web/src/lib/
    guide.ts's nearestSignature()) handles the interim rendering."""
    return signature.signature() in known_signatures()
