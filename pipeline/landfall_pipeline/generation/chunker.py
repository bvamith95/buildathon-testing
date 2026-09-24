"""Chunker with mandatory provenance.

docs/architecture.md: "Every chunk carries its source URL, document title,
publishing organisation and fetch timestamp. A chunk without provenance is
discarded rather than used."
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from bs4 import BeautifulSoup

from landfall_pipeline.crawler.crawler import FetchResult

DEFAULT_CHUNK_WORDS = 200
DEFAULT_OVERLAP_WORDS = 40


@dataclass(frozen=True)
class Chunk:
    text: str
    url: str
    title: str
    organisation: str
    fetched_at: datetime


def extract_text(html: str) -> tuple[str, str]:
    """Returns (title, main text) with scripts/styles/nav stripped."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    text = " ".join(soup.get_text(separator=" ").split())
    return title, text


def chunk_text(text: str, chunk_words: int = DEFAULT_CHUNK_WORDS, overlap_words: int = DEFAULT_OVERLAP_WORDS) -> list[str]:
    words = text.split()
    if not words:
        return []
    step = max(chunk_words - overlap_words, 1)
    return [
        " ".join(words[i : i + chunk_words])
        for i in range(0, len(words), step)
        if words[i : i + chunk_words]
    ]


def chunk_fetch_result(result: FetchResult, organisation: str) -> list[Chunk]:
    """A fetch that failed, or produced no HTML, yields no chunks — there
    is nothing with provenance to attach text to."""
    if not result.ok or not result.html:
        return []

    title, text = extract_text(result.html)
    return [
        Chunk(
            text=piece,
            url=result.entry.url,
            title=title,
            organisation=organisation,
            fetched_at=result.fetched_at,
        )
        for piece in chunk_text(text)
    ]
