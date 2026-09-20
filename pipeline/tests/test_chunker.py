from datetime import datetime, timezone

from landfall_pipeline.crawler.crawler import FetchResult
from landfall_pipeline.crawler.whitelist import WhitelistEntry
from landfall_pipeline.generation.chunker import chunk_fetch_result, chunk_text, extract_text


def test_extract_text_strips_scripts_and_nav():
    html = "<html><head><title>Test Page</title></head><body><nav>menu</nav><p>Real content here.</p><script>evil()</script></body></html>"
    title, text = extract_text(html)
    assert title == "Test Page"
    assert "Real content here." in text
    assert "menu" not in text
    assert "evil()" not in text


def test_chunk_text_splits_with_overlap():
    text = " ".join(f"word{i}" for i in range(500))
    chunks = chunk_text(text, chunk_words=200, overlap_words=40)
    assert len(chunks) > 1
    assert all(chunk for chunk in chunks)


def test_failed_fetch_produces_no_chunks():
    entry = WhitelistEntry(url="https://you.ubc.ca/x", organisation="UBC", bucket_dimension=None)
    failed = FetchResult(entry=entry, ok=False, html=None, fetched_at=datetime.now(timezone.utc), error="timeout")
    assert chunk_fetch_result(failed, organisation="UBC") == []


def test_successful_fetch_produces_chunks_with_provenance():
    entry = WhitelistEntry(url="https://you.ubc.ca/x", organisation="UBC", bucket_dimension=None)
    html = "<html><title>SIN</title><body><p>" + " ".join(f"word{i}" for i in range(50)) + "</p></body></html>"
    ok = FetchResult(entry=entry, ok=True, html=html, fetched_at=datetime.now(timezone.utc))
    chunks = chunk_fetch_result(ok, organisation="UBC")
    assert len(chunks) == 1
    assert chunks[0].url == entry.url
    assert chunks[0].organisation == "UBC"
    assert chunks[0].title == "SIN"
