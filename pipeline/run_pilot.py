"""Week 1 pilot run: one bucket, crawl -> chunk -> embed -> generate ->
diff -> write review queue (docs/implementation-plan.md, Week 1).

Deliberately NOT auto-publishing — a human reviews the generated steps
before anything reaches apps/web/public/guides/ (docs/decisions.md,
"Review-gate rejection behavior"). Run `apply_pilot_review.py` after
review to publish.

Usage: python run_pilot.py
"""

from __future__ import annotations

import sys
import time
from datetime import datetime, timezone

from landfall_pipeline.crawler.crawler import Crawler
from landfall_pipeline.crawler.whitelist import WHITELIST
from landfall_pipeline.generation.chunker import chunk_fetch_result
from landfall_pipeline.generation.embeddings import EmbeddingClient
from landfall_pipeline.generation.generator import StepGenerator
from landfall_pipeline.generation.retrieval_index import RetrievalIndex
from landfall_pipeline.review.diff import diff_guides
from landfall_pipeline.review.queue import write_queue
from landfall_pipeline.store.publish import load_previous_guide
from landfall_pipeline.store.schema import BucketSignature, Guide

# The pilot bucket: graduate, India-shaped profile (visa required,
# biometrics required, medical exam required) — matches the PRD's own
# Week 2 validation target, so this carries forward rather than being
# throwaway.
PILOT_BUCKET = BucketSignature(
    entry_document="visa_required",
    biometrics="required",
    medical_exam="required",
    funds_evidence="country_programme_variant",
    currency_corridor="restricted",
)
PILOT_PROGRAM_LEVEL = "graduate"

# A modest, deliberately small step set spanning all 5 PRD phases — proves
# the pipeline mechanics end to end without generating the full ~16-step
# guide. claim_prompt is what the generator is asked to write about; the
# generator grounds it in retrieved chunks or falls back to no_source.
PILOT_STEPS = [
    ("study-permit-apply", "after_your_offer", -90,
     "Apply for a Canadian study permit as an international graduate student, including the online application process"),
    ("book-biometrics", "after_your_offer", -75,
     "Book and complete biometrics (fingerprints and photo) as part of a Canadian study permit application"),
    ("immigration-medical-exam", "preparing_to_move", -45,
     "Complete the immigration medical exam with an IRCC panel physician before travelling to Canada on a study permit"),
    ("tuition-transfer", "preparing_to_move", -30,
     "Pay UBC tuition and fees from outside Canada as an international student, including international funds transfer options"),
    ("port-of-entry", "landing_day", 0,
     "What to expect and what documents to present at the Canadian port of entry when arriving on a study permit"),
    ("apply-for-sin", "first_two_weeks", 3,
     "Apply for a Social Insurance Number (SIN) as a new international graduate student who will work as a teaching or research assistant"),
    ("apply-for-msp", "first_two_weeks", 7,
     "Apply for BC's Medical Services Plan (MSP) as a new international student after arriving in British Columbia"),
    ("check-msp-status", "weeks_three_and_four", 20,
     "Follow up on a BC Medical Services Plan (MSP) application status and understand the coverage waiting period"),
]


def main() -> int:
    print(f"Pilot bucket signature: {PILOT_BUCKET.signature()}")
    print(f"Program level: {PILOT_PROGRAM_LEVEL}")
    print()

    # 1. Crawl
    print(f"Crawling {len(WHITELIST)} whitelisted pages...")
    crawler = Crawler()
    results = []
    for entry in WHITELIST:
        result = crawler.fetch(entry)
        status = "ok" if result.ok else f"FAILED ({result.error})"
        print(f"  [{status}] {entry.organisation}: {entry.url}")
        results.append(result)

    ok_count = sum(1 for r in results if r.ok)
    print(f"\n{ok_count}/{len(results)} pages fetched successfully.")
    if ok_count == 0:
        print("No pages fetched — aborting. Check network access to the whitelist domains.")
        return 1

    # 2. Chunk
    print("\nChunking...")
    chunks = []
    for result in results:
        chunks.extend(chunk_fetch_result(result, organisation=result.entry.organisation))
    print(f"{len(chunks)} chunks with provenance.")
    if not chunks:
        print("No chunks produced — aborting.")
        return 1

    # 3. Embed + index
    # Voyage's default rate limit without a payment method on file is 3
    # requests/minute (free tokens still apply) — throttle to stay under
    # it rather than ask for billing on a third service for a pilot run.
    print("\nEmbedding chunks (Voyage AI, throttled to 3 req/min)...")
    embeddings_client = EmbeddingClient()
    index = RetrievalIndex()
    batch_size = 8  # small enough to stay well under the 10K-tokens/min cap
    batches = [chunks[i : i + batch_size] for i in range(0, len(chunks), batch_size)]
    for batch_num, batch in enumerate(batches):
        if batch_num > 0:
            time.sleep(21)
        for attempt in range(3):
            try:
                vectors = embeddings_client.embed([c.text for c in batch], input_type="document")
                break
            except Exception as exc:  # rate limit or transient error — back off and retry
                if attempt == 2:
                    raise
                print(f"  batch {batch_num + 1} failed ({exc}); backing off 30s and retrying")
                time.sleep(30)
        for chunk, vector in zip(batch, vectors):
            index.add(chunk, vector)
        print(f"  embedded batch {batch_num + 1}/{len(batches)} ({len(batch)} chunks)")
    index.save()
    print(f"Indexed {len(chunks)} chunks.")

    # 4. Generate
    print(f"\nGenerating {len(PILOT_STEPS)} steps (Claude Opus 5)...")
    generator = StepGenerator(index=index, embeddings=embeddings_client)
    steps = []
    for i, (step_id, phase, offset_days, claim_prompt) in enumerate(PILOT_STEPS):
        if i > 0:
            time.sleep(21)  # each step embeds a query via Voyage — same rate limit applies
        for attempt in range(3):
            try:
                step = generator.generate_step(step_id, phase, offset_days, claim_prompt)
                break
            except Exception as exc:
                if attempt == 2:
                    raise
                print(f"  {step_id} failed ({exc}); backing off 30s and retrying")
                time.sleep(30)
        print(f"  [{step.state}] {step_id}: {step.title!r} (confidence={step.confidence:.2f})")
        steps.append(step)

    guide = Guide(
        content_version=1,
        program_level=PILOT_PROGRAM_LEVEL,
        bucket_signature=PILOT_BUCKET.signature(),
        steps=steps,
        generated_at=datetime.now(timezone.utc),
    )

    # 5. Diff against any previous published version (expected: none yet)
    previous = load_previous_guide(guide.cache_key())
    diffs = diff_guides(previous, guide)

    # 6. Write review queue (does NOT publish)
    write_queue(diffs)
    print(f"\nReview queue written to pipeline/data/review_queue.json ({len(diffs)} steps to review).")
    print("Nothing has been published. Review the steps above, then run apply_pilot_review.py.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
