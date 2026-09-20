# PRD Review — Landfall (UBC international student onboarding)

Reviewing `docs/prd.md`, last updated 2026-09-20. This is feedback for the team, organized by what blocks the build versus what can wait.

## Overall assessment

This is an unusually well-disciplined PRD. Nearly every scope, metric, and architecture decision is tied back to a specific survey number, and the document is honest about the survey's limits (21 respondents, graduate-only, warm demo panel) rather than hiding them. The pre-generated-cache-over-live-RAG call is the right one for a 4-week build with a hard legal/accuracy bar, and the reasoning for it is the strongest section in the document. The step-card failure states (stale, no-source, not-specific) are the kind of thing teams normally discover in week 3 under deadline pressure; here they're specified up front.

The gaps below are mostly about **making implicit mechanisms explicit** — the confidence threshold, the review-gate fallback, the bucket-to-content mapping for edge cases — and about **evidence weight**: a 21-person, self-selected, all-succeeded survey is doing a lot of load-bearing work for scope and metric decisions that will be hard to walk back later.

## Blocking — resolved 2026-09-20

These were flagged as open decisions or gaps; all four are now resolved with the product owner. Full rationale in `docs/decisions.md`. Original concern kept below for context.

1. **Confidence threshold is undefined.** ~~The entire "no fallback to unsourced prose" guarantee...~~ **Resolved:** embedding similarity to the retrieved chunk is the baseline mechanism; the review owner tunes the per-bucket cutoff after week 1's single end-to-end pilot bucket, rather than shipping one global number blind.

2. **Review gate has no failure mode.** ~~"Name the review owner" is correctly flagged as blocking week 1...~~ **Resolved:** product owner is the review owner. On a rejected step, only that step reverts to its last-published content; every other approved step in the same variant still publishes.

3. **Bucket coverage vs. the combinatorics.** ~~The bucket table has 5 dimensions × 2 values = 32 theoretical combinations...~~ **Resolved (partially):** an observed real signature outside the initial ~6 is treated as a signal to expand the generated set through the normal pipeline, not a permanent routing problem. **Still open:** the interim rendering for a user who hits an unmatched signature before it's added to the generated set — see `docs/decisions.md`, "Still open."

4. **Staleness vs. crawl cadence is underspecified.** ~~The nightly pipeline crawls the whitelist and only republishes on a diff...~~ **Resolved:** a failed crawl never advances `last_verified` (this was already built into `architecture.md` §3's sequence diagram). Additionally, 3 consecutive failed crawls on the same source now alert the review owner directly, rather than relying on the stale banner alone to surface it.

## Important — resolved 2026-09-20

5. **Undergraduate path ships untested, but only the team is told.** **Resolved:** a light in-product caveat now ships on the undergraduate guide, in addition to the internal-only framing at the demo — not instead of it.

6. **`profile_hash` may be quasi-identifying.** **Resolved:** `profile_hash` is salted per anonymous `session_id`, so it can't be matched across sessions or against the plain profile parameters in a shared URL.

7. **Housing pointer is the one unmanaged content surface.** **Resolved:** the two links are the UBC housing website and the UBC Facebook roommates group, with no affiliation claimed. The product owner verifies and updates them directly. A full housing feature is acknowledged as likely future work given the demand the survey surfaced, but stays out of scope for this build.

8. **Reminder email is both a cuttable feature and a metric dependency.** Product owner now owns securing the sending domain and unsubscribe mechanism (see `docs/decisions.md`). If the feature is still cut by week 3, the week 4 metrics report should say so explicitly rather than silently showing a zero row for `reminder_opt_in` — this remains good practice regardless of outcome.

9. **Sample-size caveat could be more visible outside this document.** **Decision:** no change — the product owner confirmed the existing inline caveats (graduate-only sample, warm demo panel, all-arrived-successfully) are sufficient.

## Minor / clarifying

10. **Demo date vs. "start of build."** The plan counts weeks "from the start of build" against an Oct 16 demo target, and the PRD was last updated today (Sep 20). Given Oct 16 is roughly 3.7 weeks from today, confirm the actual build-start date explicitly — if it's today, the 4-week plan is already slightly compressed against the demo date.

11. **"Roughly twelve guides" is used as a load-bearing number** for both the architecture argument and the week 1–2 plan, but it's an estimate ("approximately... six realistic combinations"). Once the bucket taxonomy is frozen (open decision), restate this as an exact count so week 2's "done means" criterion ("all twelve variants generated") is checkable rather than approximate.

12. Consider explicitly stating in the NFRs what happens to the "generation over budget" streaming state in a world where guides are pre-cached — the PRD's own architecture argument implies this state should rarely if ever trigger (cache read is sub-second), so it's worth confirming this state is a defensive/edge-case build (cold cache, CDN miss) rather than a commonly expected path, so it doesn't absorb build time disproportionate to how often it'll fire.

## What I'd push back on if it were about to change

Two calls in the "decided, don't reopen without new evidence" section are correctly protected, and I'd defend both as written: keeping academics out of scope (14.3%/9.5% against two anecdotes is a reasonable bar) and keeping the undergraduate path in scope (absence of data is a distribution problem, not a demand signal). These are exactly the kind of decisions a 4-week build needs frozen, and the PRD's own justification for freezing them is sound.
