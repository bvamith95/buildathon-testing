"""Re-crawl and re-embed a subset of the whitelist, merging the result
into the existing cached retrieval index rather than rebuilding it from
scratch.

Useful when only a few sources changed or newly became reachable (e.g.
the students.ubc.ca User-Agent fix, SAA-73) — avoids re-touching sources
on flaky domains that were already cached successfully. Chunks from a
refreshed URL replace that URL's old chunks (if any); everything else in
the index is untouched.

Usage:
  python refresh_pages.py --organisation UBC
  python refresh_pages.py --url https://students.ubc.ca/finances/taxes/social-insurance-number-sin/
"""

from __future__ import annotations

import argparse
import sys
import time

from landfall_pipeline.crawler.crawler import Crawler
from landfall_pipeline.crawler.whitelist import WHITELIST
from landfall_pipeline.generation.chunker import chunk_fetch_result
from landfall_pipeline.generation.embeddings import EmbeddingClient
from landfall_pipeline.generation.retrieval_index import RetrievalIndex


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--organisation", help="Only refresh whitelist entries from this organisation")
    parser.add_argument("--url", action="append", dest="urls", help="Only refresh this specific URL (repeatable)")
    args = parser.parse_args()

    entries = WHITELIST
    if args.organisation:
        entries = [e for e in entries if e.organisation == args.organisation]
    if args.urls:
        entries = [e for e in entries if e.url in args.urls]
    if not entries:
        print("No matching whitelist entries.")
        return 1

    print(f"Refreshing {len(entries)} page(s)...")
    crawler = Crawler()
    results = []
    for entry in entries:
        result = crawler.fetch(entry)
        status = "ok" if result.ok else f"FAILED ({result.error})"
        print(f"  [{status}] {entry.organisation}: {entry.url}")
        results.append(result)

    ok_results = [r for r in results if r.ok]
    if not ok_results:
        print("Nothing fetched successfully — index unchanged.")
        return 1

    new_chunks = []
    for result in ok_results:
        new_chunks.extend(chunk_fetch_result(result, organisation=result.entry.organisation))
    print(f"\n{len(new_chunks)} chunks from {len(ok_results)} refreshed page(s).")

    index = RetrievalIndex.load()
    refreshed_urls = {r.entry.url for r in ok_results}
    index._items = [item for item in index._items if item.chunk.url not in refreshed_urls]

    print("Embedding new chunks (Voyage AI, throttled to 3 req/min)...")
    embeddings_client = EmbeddingClient()
    batch_size = 8
    batches = [new_chunks[i : i + batch_size] for i in range(0, len(new_chunks), batch_size)]
    for batch_num, batch in enumerate(batches):
        if batch_num > 0:
            time.sleep(21)
        for attempt in range(3):
            try:
                vectors = embeddings_client.embed([c.text for c in batch], input_type="document")
                break
            except Exception as exc:
                if attempt == 2:
                    raise
                print(f"  batch {batch_num + 1} failed ({exc}); backing off 30s and retrying")
                time.sleep(30)
        for chunk, vector in zip(batch, vectors):
            index.add(chunk, vector)
        print(f"  embedded batch {batch_num + 1}/{len(batches)} ({len(batch)} chunks)")

    index.save()
    print(f"\nIndex updated: {len(index._items)} total chunks.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
