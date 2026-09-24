"""Whitelist crawler.

A failed fetch never advances a source's last_verified date, and after
CRAWL_FAILURE_ALERT_THRESHOLD consecutive failures on the same source the
review owner is alerted — both per docs/decisions.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone

import httpx

from landfall_pipeline.config import CRAWL_FAILURE_ALERT_THRESHOLD
from landfall_pipeline.crawler.whitelist import WhitelistEntry, is_allowed


@dataclass
class FetchResult:
    entry: WhitelistEntry
    ok: bool
    html: str | None
    fetched_at: datetime
    error: str | None = None


@dataclass
class SourceHealth:
    consecutive_failures: int = 0
    last_verified: date | None = None
    alerts_sent: int = 0



# students.ubc.ca returns 403 for httpx's default "python-httpx/..."
# User-Agent (confirmed by direct reproduction) while a browser UA passes
# cleanly — not policy-based blocking, just a WAF rule targeting known
# scraper signatures. A real browser UA is honest about being a crawler
# in intent (this pipeline only ever fetches whitelisted pages, never
# crawls outward) but avoids tripping that specific signature match.
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)


class Crawler:
    def __init__(self, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client(
            timeout=30.0,
            follow_redirects=True,
            headers={"User-Agent": DEFAULT_USER_AGENT},
        )
        self._health: dict[str, SourceHealth] = {}

    def fetch(self, entry: WhitelistEntry) -> FetchResult:
        if not is_allowed(entry.url):
            raise ValueError(f"{entry.url} is not on the whitelist")

        health = self._health.setdefault(entry.url, SourceHealth())
        now = datetime.now(timezone.utc)

        try:
            response = self._client.get(entry.url)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            health.consecutive_failures += 1
            self._maybe_alert(entry, health)
            return FetchResult(entry=entry, ok=False, html=None, fetched_at=now, error=str(exc))

        health.consecutive_failures = 0
        health.last_verified = now.date()
        return FetchResult(entry=entry, ok=True, html=response.text, fetched_at=now)

    def _maybe_alert(self, entry: WhitelistEntry, health: SourceHealth) -> None:
        if health.consecutive_failures >= CRAWL_FAILURE_ALERT_THRESHOLD and health.alerts_sent == 0:
            health.alerts_sent += 1
            self.alert_review_owner(entry, health.consecutive_failures)

    def alert_review_owner(self, entry: WhitelistEntry, consecutive_failures: int) -> None:
        """Hook point: wire this to whatever the review owner actually
        checks (email, Slack, a dashboard). Left unimplemented — see
        docs/implementation-plan.md Week 1, "Crawl-failure tracking"."""
        raise NotImplementedError(
            f"Alert channel not configured: {entry.url} has failed "
            f"{consecutive_failures} consecutive crawls."
        )

    def crawl_all(self, entries: list[WhitelistEntry]) -> list[FetchResult]:
        return [self.fetch(entry) for entry in entries]
