"""Per-bucket step plans: which steps exist and what each one is asked to
cover, derived directly from docs/prd.md's bucket table ("Drives" column)
and its program-level differences section.

A step's *existence* is gated by biometrics/medical_exam (a bucket that's
exempt/not_required simply doesn't get that step — this is real content
variation, not a missing feature). Every other bucket dimension changes a
step's *content* via its claim_prompt, which is what StepGenerator grounds
the RAG generation call in.

This intentionally does not encode different content per country beyond
what the 5-bucket taxonomy already carries — two students who share all
five buckets get identical guidance, by design (docs/prd.md: "the property
that keeps the variant count small").
"""

from __future__ import annotations

from landfall_pipeline.store.schema import BucketSignature, ProgramLevel

StepPlanEntry = tuple[str, str, int, str]


def build_step_plan(bucket: BucketSignature, level: ProgramLevel) -> list[StepPlanEntry]:
    plan: list[StepPlanEntry] = []

    if bucket.entry_document == "visa_required":
        entry_doc_note = (
            "this citizenship requires a visa to enter Canada, so a temporary resident visa "
            "is issued together with study permit approval -- cover that link and any extra "
            "processing time it adds"
        )
    else:
        entry_doc_note = (
            "this citizenship is visa-exempt and eligible for an Electronic Travel "
            "Authorization (eTA) instead of a visa -- cover applying for the eTA "
            "(a fast, separate step tied to the passport used to travel) alongside the "
            "study permit"
        )

    plan.append((
        "study-permit-apply",
        "after_your_offer",
        -90,
        f"Apply online for a Canadian study permit as an international {level} student. "
        f"Note that {entry_doc_note}.",
    ))

    if bucket.biometrics == "required":
        plan.append((
            "book-biometrics",
            "after_your_offer",
            -75,
            "Book and complete biometrics (fingerprints and photo) as part of a Canadian "
            "study permit application",
        ))

    if bucket.medical_exam == "required":
        plan.append((
            "immigration-medical-exam",
            "preparing_to_move",
            -45,
            "Complete the immigration medical exam with an IRCC panel physician before "
            "travelling to Canada on a study permit",
        ))

    funds_note = (
        "This citizenship's home country or funding programme may carry its own "
        "programme-specific proof-of-funds or outbound-payment requirements -- check both "
        "UBC's and the home country's guidance."
        if bucket.funds_evidence == "country_programme_variant"
        else "Standard proof-of-funds documentation applies, with no additional "
        "country-programme-specific requirements."
    )
    corridor_note = (
        "This is a restricted or less liquid currency corridor -- expect longer transfer "
        "lead times, fewer transfer providers, and possible exchange-control paperwork, so "
        "start well before the payment deadline."
        if bucket.currency_corridor == "restricted"
        else "This is a major, liquid currency corridor, so a standard bank wire or transfer "
        "service should be straightforward with short lead times."
    )
    plan.append((
        "tuition-transfer",
        "preparing_to_move",
        -30,
        f"Pay UBC tuition and fees from outside Canada as an international {level} student, "
        f"including international funds transfer options. {funds_note} {corridor_note}",
    ))

    entry_doc_border_note = (
        "presenting the passport and visa alongside the study permit approval letter"
        if bucket.entry_document == "visa_required"
        else "presenting the passport (the eTA is linked electronically, with no visa sticker "
        "to show) alongside the study permit approval letter"
    )
    plan.append((
        "port-of-entry",
        "landing_day",
        0,
        "What to expect and what documents to present at the Canadian port of entry when "
        f"arriving on a study permit, including {entry_doc_border_note}",
    ))

    if level == "graduate":
        plan.append((
            "apply-for-sin",
            "first_two_weeks",
            3,
            "Apply for a Social Insurance Number (SIN) with Service Canada as a new "
            "international graduate student, needed promptly since graduate students often "
            "work as teaching or research assistants and a delay pushes back payroll",
        ))
    else:
        plan.append((
            "apply-for-sin",
            "first_two_weeks",
            10,
            "Apply for a Social Insurance Number (SIN) as a new international undergraduate "
            "student, needed for any on-campus or off-campus work eligibility",
        ))

    plan.append((
        "apply-for-msp",
        "first_two_weeks",
        7,
        f"Apply for BC's Medical Services Plan (MSP) as a new international {level} student "
        "after arriving in British Columbia, including which UBC office handles enrolment "
        f"for {level} students and the interim private coverage gap during MSP's wait period",
    ))

    plan.append((
        "check-msp-status",
        "weeks_three_and_four",
        20,
        "Follow up on a BC Medical Services Plan (MSP) application status and understand "
        "the coverage waiting period",
    ))

    return plan
