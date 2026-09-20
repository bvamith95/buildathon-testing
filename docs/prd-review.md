# PRD Review — Landfall (UBC international student onboarding)

Reviewing `docs/prd.md`, last updated 2026-09-20. This is feedback for the team, organized by what blocks the build versus what can wait.

## Overall assessment

This is an unusually well-disciplined PRD. Nearly every scope, metric, and architecture decision is tied back to a specific survey number, and the document is honest about the survey's limits (21 respondents, graduate-only, warm demo panel) rather than hiding them. The pre-generated-cache-over-live-RAG call is the right one for a 4-week build with a hard legal/accuracy bar, and the reasoning for it is the strongest section in the document. The step-card failure states (stale, no-source, not-specific) are the kind of thing teams normally discover in week 3 under deadline pressure; here they're specified up front.

The gaps below are mostly about **making implicit mechanisms explicit** — the confidence threshold, the review-gate fallback, the bucket-to-content mapping for edge cases — and about **evidence weight**: a 21-person, self-selected, all-succeeded survey is doing a lot of load-bearing work for scope and metric decisions that will be hard to walk back later.

## Blocking — resolve before the relevant week starts

These are mostly already flagged as open decisions in the PRD; this section adds why each one is riskier than it looks.

1. **Confidence threshold is undefined.** The entire "no fallback to unsourced prose" guarantee — the product's core safety claim — rests on a "confidence threshold" that's referenced four times but never defined as a mechanism. Is it embedding similarity to the query, an LLM self-assessed score, or a human-set cutoff per bucket? This needs a concrete definition before week 1 content generation starts, not as a tuning parameter discovered during review. Recommend specifying it in the same document that freezes the bucket taxonomy.

2. **Review gate has no failure mode.** "Name the review owner" is correctly flagged as blocking week 1, but the PRD doesn't say what happens if that name isn't attached by the week-1 deadline. Given the gate is described as *the* mitigation for "a published step is materially wrong" (severe impact), the plan should say explicitly: does content generation pause, or does an un-reviewed variant ship with a visible "unreviewed" flag? Silence here means the team defaults to shipping unreviewed content under deadline pressure, which is the one failure mode the whole architecture exists to prevent.

3. **Bucket coverage vs. the combinatorics.** The bucket table has 5 dimensions × 2 values = 32 theoretical combinations, but the PRD says only 6 are "realistic" (giving ~12 guides total). Worth naming: which combinations are excluded, and what happens when a real applicant doesn't match any of the 6? The "not-specific" state covers steps that aren't personalized, but there's no stated behavior for a *bucket signature* that has no pre-generated guide at all — does intake silently round them to the nearest bucket, or is there a visible "we don't have your exact situation yet" state at the guide level? This is a day-one production question, not an edge case, because citizenship-derived buckets for a 190-country intake will hit unlisted combinations quickly.

4. **Staleness vs. crawl cadence is underspecified.** The nightly pipeline crawls the whitelist and only republishes on a diff, but the recheck window (proposed 30/90 days) measures time since *last verified*, not time since *last crawled*. If a page fails to crawl for several nights (timeout, whitelist site restructure, robots change), does `last_verified` silently stop advancing, correctly triggering the stale banner — or does a failed crawl get treated as "no change" and the date advances anyway? The diagram's "Diff vs previous" step should distinguish "checked, unchanged" from "check failed" for this to behave as designed.

## Important — should be resolved but doesn't block week 1

5. **Undergraduate path ships untested, but only the team is told.** The risk table marks this "Certain / Medium," mitigated by "say so internally... do not present as validated at the demo." That protects the demo, not the users who actually pick "undergraduate" during the real run. Given the stated legal posture (no advice, no guaranteed outcomes) already carries real weight for immigration/financial content, consider surfacing the same caveat to undergraduate users themselves — even a one-line "this path is newer and less tested" respects the same content-integrity standard the PRD holds itself to elsewhere (every source has a visible last-checked date; this is the analogous disclosure for a whole path).

6. **`profile_hash` may be quasi-identifying.** The feedback payload includes `profile_hash`, presumably a hash of citizenship + arrival date + level. With ~12 buckets and dates at day granularity, this hash has low entropy per profile and could re-identify a specific student when cross-referenced with the arrival-date-derived URL parameters (`c=IN&d=2026-08-25&l=grad`) that the same PRD makes shareable by design. Worth a line on whether the hash is salted/rotated and whether "no PII" holds up under this combination, especially since the URL itself is explicitly designed to be shared over WhatsApp.

7. **Housing pointer is the one unmanaged content surface.** Every other link in the product goes through the whitelist-ingestion-citation-lastchecked pipeline. The two housing starting-point links on the landing page are explicitly exempted from all of that, by design, since housing isn't on the whitelist. That's a reasonable call, but it means there's no mechanism in this architecture to catch those two links going stale or dead — worth a manual recheck cadence, even a low-frequency one, called out somewhere (the review owner's monthly task list, say).

8. **Reminder email is both a cuttable feature and a metric dependency.** Week 3's plan allows cutting reminders if the sending domain/unsubscribe mechanism isn't resolved. But `reminder_opt_in` is also listed as a supporting success signal, and the NFR section treats the opt-in flow as a privacy commitment ("only with explicit opt-in"). If the feature is cut, the metrics report in week 4 should say so explicitly rather than silently showing a zero or missing row.

9. **Sample-size caveat could be more visible outside this document.** The PRD is careful internally (the helpful-rate-as-ceiling caution, the graduate-only caveat), but decisions like "academics stay out of scope" are stated as settled facts in the risk table and scope section. If this document is forwarded to stakeholders who won't read the evidence table closely, consider a single caveat line near the top: *these are directional signals from 21 people, not statistically powered results* — mainly so a future "but the data says 14.3%" argument doesn't get treated as more precise than it is.

## Minor / clarifying

10. **Demo date vs. "start of build."** The plan counts weeks "from the start of build" against an Oct 16 demo target, and the PRD was last updated today (Sep 20). Given Oct 16 is roughly 3.7 weeks from today, confirm the actual build-start date explicitly — if it's today, the 4-week plan is already slightly compressed against the demo date.

11. **"Roughly twelve guides" is used as a load-bearing number** for both the architecture argument and the week 1–2 plan, but it's an estimate ("approximately... six realistic combinations"). Once the bucket taxonomy is frozen (open decision), restate this as an exact count so week 2's "done means" criterion ("all twelve variants generated") is checkable rather than approximate.

12. Consider explicitly stating in the NFRs what happens to the "generation over budget" streaming state in a world where guides are pre-cached — the PRD's own architecture argument implies this state should rarely if ever trigger (cache read is sub-second), so it's worth confirming this state is a defensive/edge-case build (cold cache, CDN miss) rather than a commonly expected path, so it doesn't absorb build time disproportionate to how often it'll fire.

## What I'd push back on if it were about to change

Two calls in the "decided, don't reopen without new evidence" section are correctly protected, and I'd defend both as written: keeping academics out of scope (14.3%/9.5% against two anecdotes is a reasonable bar) and keeping the undergraduate path in scope (absence of data is a distribution problem, not a demand signal). These are exactly the kind of decisions a 4-week build needs frozen, and the PRD's own justification for freezing them is sound.
