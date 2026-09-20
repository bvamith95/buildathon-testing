# Landfall — Architecture Document

Companion to `docs/prd.md`. This expands the PRD's "Architecture and content pipeline" section into a full system design: components, data flow, data model, and the operational questions the PRD leaves open (see `docs/prd-review.md` items 1–4). Nothing here overrides a PRD decision; it makes the mechanics behind those decisions concrete enough to build against.

## 1. System context

Landfall has two active users (the student, and the human reviewer who gates content) and four passive data sources it reads but never writes to.

```mermaid
flowchart TB
  Student["Student<br/>(mobile during the move,<br/>desktop for forms)"]
  Reviewer["Content reviewer<br/>(signs off changed steps)"]

  Landfall(["Landfall<br/>personalised, source-cited<br/>onboarding checklist"])

  UBC["UBC sites<br/>tuition, health plan,<br/>SIN-for-payroll, offices"]
  IRCC["IRCC<br/>permit, biometrics, medical exam"]
  BC["BC government<br/>provincial health (MSP)"]
  CRA["CRA<br/>SIN, tax residency basics"]
  Email["Transactional email provider<br/>(post-MVP)"]

  Student -->|"level, citizenship,<br/>arrival date, feedback"| Landfall
  Reviewer -->|"reviews + approves publish"| Landfall
  Landfall -->|"nightly crawl,<br/>whitelisted pages only"| UBC
  Landfall -->|"nightly crawl,<br/>whitelisted pages only"| IRCC
  Landfall -->|"nightly crawl,<br/>whitelisted pages only"| BC
  Landfall -->|"nightly crawl,<br/>whitelisted pages only"| CRA
  Landfall -.->|"sends reminders<br/>on opt-in (post-MVP)"| Email
```

Two things this diagram is meant to make obvious: the crawl direction is strictly one-way (Landfall reads the whitelist; nothing the four sources do reaches a user without passing through generation, diff, and human review first), and the reviewer is a first-class actor, not a background process — the architecture doesn't work without someone in that role.

## 2. Containers

The system splits cleanly along the PRD's central decision: an **offline pipeline** that runs nightly and never faces a user request, and an **online serving path** that never calls an LLM and is a cache read.

```mermaid
flowchart TB
  subgraph Offline["Offline — nightly, no request-path latency budget"]
    direction TB
    Crawler["Whitelist crawler"]
    Chunker["Chunker + provenance tagger"]
    Index["Retrieval index<br/>(chunks + embeddings)"]
    Gen["Variant generator<br/>(RAG, per bucket × level)"]
    Diff["Diff engine<br/>vs previous published version"]
    ReviewUI["Review queue UI<br/>changed steps only"]
    Publish["Publish service<br/>bumps content_version"]

    Crawler --> Chunker --> Index --> Gen --> Diff --> ReviewUI --> Publish
  end

  subgraph Store["Storage"]
    GuideStore[("Guide store<br/>versioned, keyed by<br/>bucket_signature + level")]
    Events[("Analytics + feedback store")]
  end

  subgraph Online["Online — request path, sub-second budget"]
    direction TB
    Client["Client app<br/>(mobile-first SPA)"]
    Resolver["Bucket resolver<br/>(client-side, from citizenship+level)"]
    Edge["Edge cache / CDN"]
    API["Feedback + analytics API"]
  end

  Publish --> GuideStore
  GuideStore --> Edge
  Client --> Resolver --> Edge --> Client
  Client --> API --> Events
```

Why this split matters operationally: the offline side can be slow, can fail a crawl, can wait on a human, and none of that touches the 15-second time-to-value budget. The online side has no LLM call, no crawl, no review step — it is a lookup by `bucket_signature + program_level` against a store that was fully populated the night before. This is what makes "under 2 seconds, expected" (PRD, success metrics) an architectural guarantee rather than an optimization target.

## 3. Offline content pipeline — sequence

This expands the PRD's `W → X → Y → Z → R → P → S` diagram into what actually happens on a nightly run, including the two failure paths the PRD review flags: a step that can't clear the confidence threshold, and a crawl that fails outright.

```mermaid
sequenceDiagram
  participant Cron as Nightly scheduler
  participant Crawler
  participant Chunker
  participant Index as Retrieval index
  participant Gen as Variant generator
  participant Diff as Diff engine
  participant Reviewer as Human reviewer
  participant Publish as Publish service
  participant Store as Guide store

  Cron->>Crawler: run(whitelist)
  loop each whitelisted page
    Crawler->>Crawler: fetch page
    alt fetch succeeds
      Crawler->>Chunker: page + fetch_timestamp
      Chunker->>Chunker: chunk + attach {url, title, org, fetched_at}
      Chunker->>Index: upsert chunks
    else fetch fails
      Crawler->>Crawler: mark source unreachable, keep prior last_verified
      Note right of Crawler: does NOT advance last_verified —<br/>failed crawl ≠ confirmed unchanged
    end
  end

  Cron->>Gen: generate(bucket × level) for all variants
  loop each step in each variant
    Gen->>Index: retrieve top chunks
    alt best chunk confidence >= threshold
      Gen->>Gen: emit step in "verified" state, cite chunk(s)
    else
      Gen->>Gen: emit step in "no-source" state, no generated prose
    end
  end

  Gen->>Diff: new variant set
  Diff->>Diff: compare step-by-step vs previously published version
  Diff->>Reviewer: queue of changed steps only

  alt reviewer approves
    Reviewer->>Publish: sign off
    Publish->>Store: write new content_version, reviewed_by, reviewed_at
    Store-->>Store: bump monotonic content_version
  else reviewer rejects a step
    Reviewer->>Gen: revert that step to last-published content
    Note right of Reviewer: unreviewed content never reaches Store
  end
```

Two mechanics worth calling out because they resolve open questions from the PRD review:

- **A failed crawl never silently advances `last_verified`.** The diagram makes that an explicit branch. This is what keeps the stale-banner threshold meaningful — "stale" always means "actually unconfirmed for N days," not "we forgot to check but assumed no news was good news."
- **The confidence threshold is evaluated per step, per variant, every run** — not once at build time. A step that was verified last week can legitimately drop to no-source this week if the underlying page changed enough that retrieval no longer clears the bar. That's a feature: it's the mechanism that keeps "no fallback to unsourced prose" true even as source pages drift.

## 4. Online request path — sequence

This is the path a student's device actually takes, from landing to a rendered guide. Nothing in this path calls an LLM.

```mermaid
sequenceDiagram
  participant U as Student (browser)
  participant C as Client app
  participant Edge as Edge cache
  participant API as Feedback/analytics API

  U->>C: taps program level (landing)
  Note over C: fires level_selected (completion denominator)
  U->>C: submits citizenship + arrival date (intake)
  C->>C: resolve citizenship -> 5 rule buckets -> bucket_signature
  C->>C: paint phase skeleton immediately<br/>(pure arithmetic on arrival date, no network)
  C->>Edge: GET guide(bucket_signature, program_level)
  alt cache hit (expected case)
    Edge-->>C: cached Guide record (content_version, steps[])
    C->>C: resolve each step's date = arrival_date + offset_days<br/>(clamped to business days)
    C->>C: render timeline with real dates
    Note over C: fires guide_generated {profile_hash, version, latency_ms}
  else cache miss / bucket signature unseen
    Edge-->>C: 404 / no variant for this signature
    C->>C: render "we don't have your exact situation yet" guide-level state
  end
  U->>C: ticks steps, taps thumbs
  C->>API: step_checked / feedback_submitted (with content_version, profile_hash)
  API->>API: store event
```

The "cache miss / bucket signature unseen" branch is not in the PRD's flow diagrams but follows directly from PRD review item 3: with 5 binary buckets there are 32 theoretical signatures against ~6 pre-generated ones, so the online path needs a defined, designed response rather than an undefined 404. This is a guide-level state alongside the ones the PRD already specifies (arrival date in the past, well past the window, all steps done) — same family, same design bar.

Note also that `arrival_date` never appears in the cache key or in the request to the edge cache — exactly as the PRD specifies. It only enters at the last step, client-side, to turn `offset_days` into real dates. This is what lets one cached guide serve every student in a bucket, and it's the reason time-to-value can hit sub-2-second: the only per-user computation is date arithmetic in the browser.

## 5. Bucket resolution

The PRD is explicit that citizenship is not a single variable. This is the resolution logic implied by the bucket table, made explicit as a decision flow:

```mermaid
flowchart TD
  Start["Citizenship (passport country) + program level"] --> B1
  B1{"Entry document rule?"} -->|eTA| B1a[electronic authorisation]
  B1{"Entry document rule?"} -->|Visa required| B1b[visa required]
  B1a --> B2
  B1b --> B2
  B2{"Biometrics required?"} --> B3
  B3{"Medical exam required?"} --> B4
  B4{"Funds evidence: standard or<br/>country-programme variant?"} --> B5
  B5{"Currency corridor:<br/>major or restricted?"} --> Sig["bucket_signature<br/>(5-tuple)"]
  Sig --> Lookup{"Signature has a<br/>pre-generated variant?"}
  Lookup -->|yes| Guide["Serve cached Guide<br/>for (bucket_signature, program_level)"]
  Lookup -->|no| Fallback["Guide-level 'not covered yet' state<br/>(see request-path sequence, §4)"]
```

This resolution happens entirely client-side at intake time — it's a lookup table, not a call to the generation pipeline — which is why it can run before the cache request and doesn't count against the time-to-value budget.

## 6. Client state resolution (URL / localStorage / fresh)

The PRD specifies profile-in-URL as the mobile-to-desktop handoff and sharing mechanism, with a defined resolution order so a shared link doesn't leak the sender's progress to the recipient. As a flow:

```mermaid
flowchart TD
  Load["Page load"] --> HasURL{"URL has<br/>c, d, l params?"}
  HasURL -->|yes| BuildFromURL["Resolve bucket + fetch guide<br/>for THIS visitor from URL profile"]
  HasURL -->|no| HasLocal{"localStorage has<br/>a saved profile?"}
  HasLocal -->|yes| RestoreLocal["Restore profile + checkbox state<br/>+ last-seen content_version"]
  HasLocal -->|no| FreshStart["Landing -> Intake<br/>(new visitor)"]

  BuildFromURL --> CheckOwn["Look up own checkbox state<br/>in localStorage, keyed on this profile"]
  CheckOwn --> OwnFound{"Found?"}
  OwnFound -->|yes, matches this profile| Merge["Own progress + shared guide"]
  OwnFound -->|no| CleanGuide["Guide with no progress<br/>(recipient of a shared link)"]

  RestoreLocal --> VersionCheck{"content_version advanced<br/>since last visit?"}
  VersionCheck -->|yes| ChangeBanner["Show change banner"]
  VersionCheck -->|no| Normal["Render normally"]
  RestoreLocal --> ArrivalCheck{"Arrival date now in the past?"}
  ArrivalCheck -->|yes| PostArrival["Switch to post-arrival variant"]
```

The key correctness property, carried over directly from the PRD: checkbox state in `localStorage` must be keyed on **profile** (bucket_signature + level + arrival date), not just present unscoped — otherwise a shared link with a different profile than the recipient's own saved one would incorrectly show the sender's progress. The PRD's resolution order (URL, then localStorage, then fresh) implies this keying; making it explicit here so it isn't lost in implementation.

## 7. Data model

```mermaid
erDiagram
  GUIDE ||--o{ STEP : contains
  GUIDE ||--o{ FEEDBACK : "receives (overall)"
  STEP ||--o{ FEEDBACK : "receives (per-step)"
  STEP ||--o{ SOURCE : "cites"

  GUIDE {
    string content_version
    string program_level
    string bucket_signature
    datetime generated_at
    string reviewed_by
    datetime reviewed_at
  }

  STEP {
    string id PK "stable across content versions"
    string phase
    int offset_days
    string title
    string why
    string_array prerequisites
    string cost
    string time_estimate
    string where_label
    string where_host
    string where_url
    string office_name
    string office_note
    string_array applies_to_rules
    float confidence
    string state "verified | stale | no_source | not_specific"
  }

  SOURCE {
    string organisation
    string title
    string url
    date last_verified
  }

  FEEDBACK {
    string scope "step | overall"
    string value
    string_array reason
    string text
    string step_id FK "null if scope=overall"
    string profile_hash
    string content_version
    string session_id
    int seconds_since_generation
  }
```

Two constraints from the PRD that the schema must preserve, called out because they're easy to lose in a quick implementation:

- **`STEP.id` is stable across content versions.** It's the join key for a returning user's checkbox state in `localStorage`. If a content update changes step ordering and `id` is derived from array position instead of being assigned once and kept, every returning user's ticked steps silently reassign to the wrong step. This has to be an explicit, author-assigned identifier from the moment the step schema is frozen (week 1).
- **`GUIDE` is keyed on `(bucket_signature, program_level)`, never on an individual user or on `arrival_date`.** This is the entire reason one cached record serves an unbounded number of students.

## 8. Deployment shape (demo scale)

Not specified in the PRD in infrastructure terms; included here only to confirm the architecture doesn't need anything exotic at demo scale (~12 guides, a few hundred demo-day sessions).

```mermaid
flowchart LR
  subgraph Nightly["Nightly batch (any scheduler: cron, CI job)"]
    Pipeline["Content pipeline (§3)"]
  end
  Pipeline -->|writes| DB[("Guide store<br/>small — ~12 records")]
  DB -->|read-through| CDN["CDN / edge cache<br/>guides are static JSON per signature"]
  Browser["Student's browser"] -->|GET| CDN
  Browser -->|POST events| API["Thin API<br/>(feedback + analytics only)"]
  API --> EventsDB[("Events store")]
```

At twelve guide variants, the entire Guide store fits comfortably in memory or as static JSON files behind a CDN — there is no scaling problem on the read path at this scope. The only stateful write path in the online system is the feedback/analytics API, which is low-volume and non-blocking (the guide renders whether or not an event write succeeds).

## Open items this document surfaces but doesn't resolve

These map to blocking items in `docs/prd-review.md` and need an owner's decision, not an engineering default:

1. Exact definition of "confidence threshold" (embedding similarity cutoff, or something else) — needed before week 1 variant generation.
2. Behavior on review rejection: does the whole nightly publish hold, or does only the rejected step revert while the rest of that variant publishes? The sequence in §3 assumes per-step revert; confirm that's intended.
3. The "signature has no pre-generated variant" guide-level state (§4, §5) needs the same design treatment as the PRD's other guide-level states — it's a real path at 32 theoretical vs. ~6 realized bucket signatures.
4. Whether a failed crawl (§3) should alert someone (the review owner?) after N consecutive failures, so a whitelist site restructuring doesn't quietly freeze a source's `last_verified` date for weeks before anyone notices the stale banners piling up.
