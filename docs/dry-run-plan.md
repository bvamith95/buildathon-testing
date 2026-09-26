# Dry run plan (SAA-58)

The PRD's Week 4 "done means" is two things: the metrics report generates
(SAA-51, done — see `apps/web/scripts/metrics-report.mjs`), and no critical
issue turns up in a dry run with three panel members from outside the
original 21-person survey.

That second condition needs a defined protocol to actually be checkable —
"no critical issue" is meaningless without agreeing what counts as one
first. Neither `prd.md` nor `decisions.md` defines it, so this document
does, plus the mechanics of running the session and reading the results
back out afterward.

## Why outside the original survey

`prd.md`'s own caution: 12 of the 21 survey respondents asked to trial the
tool, 9 left an email — that panel is warm and will rate the product
generously. The dry run exists specifically to get a reaction from people
who have no relationship to this project, before the real launch does.
Recruiting a fourth panel member from the original 21 defeats the point
even if the other three are new; keep it to genuinely new people.

## Who to recruit

Three admitted UBC international students who did **not** respond to the
original survey. Reasonable targets:

- At least one graduate and one undergraduate (the undergrad path has its
  own in-product caveat, `docs/decisions.md` item 5 — worth seeing whether
  that caveat actually lands or just reads as filler)
- Ideally a spread of citizenships that land in different buckets (e.g.
  one visa-required, one eTA-eligible — `apps/web/src/lib/buckets.ts`), so
  the session isn't just re-testing the one pilot bucket everyone else has
  already looked at
- People who'd actually use this: someone who hasn't yet done their study
  permit/SIN/MSP paperwork, not someone already fully settled

## What counts as a critical issue

A finding is **critical** — blocks calling the dry run clean — if it's any
of:

1. **Breaks the core promise.** A "verified" step's source link is dead,
   wrong, or doesn't actually support the claim shown. This is the one
   thing the whole architecture (whitelist, citations, confidence
   threshold) exists to prevent — any instance of it is critical by
   definition, no matter how minor it looks.
2. **Blocks task completion.** The participant cannot get from landing to
   a rendered guide at all, or the app crashes/white-screens, for their
   real citizenship + program level + arrival date.
3. **Shows another user's data.** Any sign of checkbox state, profile, or
   feedback bleeding across sessions/profiles. (This exact class of bug
   was found and fixed twice already this build — SAA-73's crawl-cache
   issue aside, the checkbox cross-guide leak and the missing arrival-date
   scoping — so it's explicitly worth re-checking here, not assuming
   fixed-and-done.)
4. **Silent data loss.** A rating, checkbox, or reminder opt-in the
   participant visibly submitted doesn't show up in Supabase afterward
   (see "Reading results back," below, for how to check).

Everything else — confusing wording, a caveat that doesn't land, a step
that feels oddly placed, "I wish it also covered X" — is a **finding**,
worth writing down and worth fixing before general launch, but it does not
block calling this gate passed. Write findings down anyway; there's no
reason to lose them.

## Running the session

Moderated, one participant at a time, think-aloud, no coaching:

1. Give them nothing but the production URL (whatever Vercel deploy is
   live). Don't pre-explain what the product does — the landing page is
   supposed to do that.
2. Ask them to imagine they're an admitted international student about to
   move to UBC, and to talk through what they're thinking as they go.
3. Let them pick their own real (or realistic) citizenship, program level,
   and arrival date on Intake. Don't steer them toward the pilot bucket.
4. Once the guide renders, ask them to actually use it as they naturally
   would for a few minutes: expand a step or two, check off something,
   give at least one step and the overall checklist a rating (thumbs
   up or down — if down, let them pick reasons/write text same as they
   would unprompted), and try the reminder opt-in if they get to it.
   Don't prompt for these one at a time like a script — just let the
   session run and note which ones happened organically.
5. Afterward, ask directly: anything confusing? Anything you didn't
   trust? Anything you expected to see that wasn't there? (Housing is a
   likely answer — that's expected and already a known, accepted gap, not
   a new finding.)

Record, per participant: device/browser used, citizenship/level/date they
entered, which of the actions in step 4 they did unprompted vs needed a
nudge for, any critical issues (definition above), and other findings/
direct quotes. A plain table or a doc per participant both work — there's
no dedicated template file for this, since the content is inherently
about what actually happens in the room, not something to pre-structure
in code.

## Reading results back afterward

Two complementary sources — the moderator's notes (the only way to catch
"confusing" or "didn't trust it," since silence in the analytics doesn't
mean nothing was wrong) and the actual instrumented data:

```
cd apps/web
npm run metrics -- --since=<dry-run-start-ISO-date> --until=<dry-run-end-ISO-date>
```

Bound the window tightly around the actual session block (both flags
accept any Postgres-parseable timestamp, e.g. `2026-10-06` or
`2026-10-06T14:00:00Z`). Since there's no other real traffic yet
pre-launch, a same-day window cleanly isolates just these three sessions
without needing to know their session ids.

Cross-check specifically for silent data loss (critical issue #4): the
metrics report's counts of `feedback_submitted`, `step_checked`, and
reminder opt-ins for that window should roughly match what the moderator
watched happen live. A mismatch (moderator saw a rating submitted, report
shows none) is itself a critical issue worth chasing down before anything
else.

Given n=3, don't read the completion/helpful-rate percentages as
meaningful statistics — three people is a smoke test, not a sample. The
value here is entirely in the moderated observations and the pass/fail on
critical issues; the metrics report mostly matters as the cross-check
above and as the first real dry run of the report generator itself.
