"""The whitelist: the only pages the crawler may ever fetch.

docs/architecture.md: "Strictly the whitelisted domains, no crawling
outward." Researched 2026-09-24, product-owner signed off the same day
(see docs/decisions.md) — all 22 URLs below are confirmed. Liveness was
not verified from this sandbox (network policy blocks outbound requests
to all four domains); re-check reachability the first time this runs
somewhere with real network access, before trusting the pilot run's
output.

Naming note (resolved): the PRD/architecture docs originally called the
fourth org "CRA," but the actual SIN-application pages below are
published by Service Canada (part of ESDC), not the Canada Revenue
Agency. Corrected in prd.md/architecture.md/CLAUDE.md to "Service
Canada/CRA" for the whitelist-boundary label; each entry below is
individually tagged with its true publisher ("Service Canada" or "CRA")
so the citation shown to users is always accurate regardless of the
category label.
"""

from dataclasses import dataclass

ALLOWED_DOMAINS = frozenset(
    {
        "you.ubc.ca",
        "students.ubc.ca",
        "ircc.canada.ca",
        "www2.gov.bc.ca",
        "www.canada.ca",  # covers both IRCC and CRA canada.ca paths
    }
)


@dataclass(frozen=True)
class WhitelistEntry:
    url: str
    organisation: str
    bucket_dimension: str | None
    """Which bucket dimension this page informs (e.g. "biometrics"), or
    None for general content not tied to a single dimension."""


# Confirmed by the product owner 2026-09-24 (see docs/decisions.md).
WHITELIST: list[WhitelistEntry] = [
    # --- IRCC: study permit, biometrics, medical exam, port of entry ---
    WhitelistEntry(
        url="https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html",
        organisation="IRCC",
        bucket_dimension="entry_document",
    ),
    WhitelistEntry(
        url="https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/apply.html",
        organisation="IRCC",
        bucket_dimension="entry_document",
    ),
    WhitelistEntry(
        url="https://www.canada.ca/en/immigration-refugees-citizenship/services/biometrics.html",
        organisation="IRCC",
        bucket_dimension="biometrics",
    ),
    WhitelistEntry(
        url="https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/standard-requirements/medical-requirements/exam/who-may-perform-immigration-medical-examination.html",
        organisation="IRCC",
        bucket_dimension="medical_exam",
    ),
    WhitelistEntry(
        url="https://ircc.canada.ca/english/helpcentre/answer.asp?qnum=184&top=17",
        organisation="IRCC",
        bucket_dimension="medical_exam",
    ),
    WhitelistEntry(
        url="https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/prepare-arrival.html",
        organisation="IRCC",
        bucket_dimension=None,  # landing day / port of entry
    ),
    WhitelistEntry(
        url="https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/after-apply-next-steps.html",
        organisation="IRCC",
        bucket_dimension=None,
    ),
    # --- UBC: tuition, SIN (payroll angle), health insurance, dates ---
    WhitelistEntry(
        url="https://students.ubc.ca/finances/tuition-fees/paying-tuition/",
        organisation="UBC",
        bucket_dimension="currency_corridor",
    ),
    WhitelistEntry(
        url="https://you.ubc.ca/financial-planning/financial-schedule/",
        organisation="UBC",
        bucket_dimension=None,
    ),
    WhitelistEntry(
        url="https://students.ubc.ca/finances/taxes/social-insurance-number-sin/",
        organisation="UBC",
        bucket_dimension=None,
    ),
    WhitelistEntry(
        url="https://students.ubc.ca/health/health-insurance/health-insurance-international/",
        organisation="UBC",
        bucket_dimension=None,
    ),
    WhitelistEntry(
        url="https://students.ubc.ca/health/health-insurance/health-insurance-international/medical-services-plan-msp-international/",
        organisation="UBC",
        bucket_dimension=None,
    ),
    WhitelistEntry(
        url="https://students.ubc.ca/health/health-insurance/health-insurance-international/medical-services-plan-msp-international/apply-bc-medical-services-plan-msp/",
        organisation="UBC",
        bucket_dimension=None,
    ),
    WhitelistEntry(
        url="https://students.ubc.ca/enrolment/dates-deadlines/",
        organisation="UBC",
        bucket_dimension=None,
    ),
    # --- Government of BC: MSP (provincial health coverage) ---
    WhitelistEntry(
        url="https://www2.gov.bc.ca/gov/content/health/health-drug-coverage/msp/bc-residents/eligibility-and-enrolment/how-to-enrol",
        organisation="Government of BC",
        bucket_dimension=None,
    ),
    WhitelistEntry(
        url="https://www2.gov.bc.ca/gov/content/health/health-drug-coverage/msp/bc-residents/eligibility-and-enrolment/are-you-eligible",
        organisation="Government of BC",
        bucket_dimension=None,
    ),
    WhitelistEntry(
        url="https://www2.gov.bc.ca/gov/content/health/health-drug-coverage/msp/bc-residents/eligibility-and-enrolment/apply-for-msp",
        organisation="Government of BC",
        bucket_dimension=None,
    ),
    # --- Service Canada (ESDC): SIN applications — see naming note above ---
    WhitelistEntry(
        url="https://www.canada.ca/en/employment-social-development/services/sin.html",
        organisation="Service Canada",
        bucket_dimension=None,
    ),
    WhitelistEntry(
        url="https://www.canada.ca/en/employment-social-development/services/sin/apply.html",
        organisation="Service Canada",
        bucket_dimension=None,
    ),
    WhitelistEntry(
        url="https://www.canada.ca/en/employment-social-development/services/sin/required-documents.html",
        organisation="Service Canada",
        bucket_dimension=None,
    ),
    # --- CRA proper: tax residency (genuinely CRA-published) ---
    WhitelistEntry(
        url="https://www.canada.ca/en/revenue-agency/services/tax/international-non-residents/individuals-leaving-entering-canada-non-residents/newcomers-canada-immigrants.html",
        organisation="CRA",
        bucket_dimension=None,
    ),
    WhitelistEntry(
        url="https://www.canada.ca/en/revenue-agency/services/tax/international-non-residents/individuals-leaving-entering-canada-non-residents/international-students-studying-canada.html",
        organisation="CRA",
        bucket_dimension=None,
    ),
]


def is_allowed(url: str) -> bool:
    from urllib.parse import urlparse

    host = urlparse(url).netloc
    return host in ALLOWED_DOMAINS
