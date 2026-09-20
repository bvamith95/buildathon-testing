"""The whitelist: the only pages the crawler may ever fetch.

docs/architecture.md: "Strictly the whitelisted domains, no crawling
outward." docs/decisions.md froze the taxonomy but a specific page list
still needs to be drafted and confirmed by the product owner before the
Week 1 pilot bucket run (see docs/implementation-plan.md, Week 1).

TODO(week 1, blocking pilot run): replace this placeholder with the
confirmed list of specific official pages per bucket dimension.
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


# Placeholder seed list — NOT yet confirmed. Do not run a real pipeline
# pass against this without product-owner sign-off on the URLs.
WHITELIST: list[WhitelistEntry] = []


def is_allowed(url: str) -> bool:
    from urllib.parse import urlparse

    host = urlparse(url).netloc
    return host in ALLOWED_DOMAINS
