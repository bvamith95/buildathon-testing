# Mobile / browser testing matrix

Covers `docs/implementation-plan.md`'s Week 4 items (Linear SAA-54 "Mobile
testing on mid-range Android," SAA-55 "Browser matrix testing"): current
Chrome/Safari/Firefox/Edge, iOS Safari and Android Chrome one version back,
and a mid-range Android on campus wifi rather than a laptop on fibre.

## What this sandbox can and can't actually test

This environment only has Chromium installed (`/opt/pw-browsers` — no
Firefox, no WebKit). That means everything below the line is a genuine,
automated result against a real rendering engine; everything above it is
something Chromium emulation cannot substitute for, and still needs a
person on the real thing before this item is fully closed.

**Needs a human on real hardware/browsers — not yet done:**

| # | What | Why emulation can't cover it |
| --- | --- | --- |
| 1 | Safari (macOS) and iOS Safari, current + one version back | Different rendering engine (WebKit, not Chromium). Two concrete risk spots in this codebase: the native `<input type="date">` on the Intake screen renders a completely different picker UI in Safari than Chromium, and `env(safe-area-inset-bottom)` on the guide page's floating rating button only has a non-zero value on a real device with a notch/home-indicator — Chromium emulation reports 0 regardless of device profile, so it's never actually been seen inset on a real iPhone |
| 2 | Firefox, current | Different engine (Gecko). No specific known risk spot, but untested |
| 3 | Edge, current | Chromium-based like this session's browser, but ships its own defaults (e.g. tracking prevention, autofill behavior) that can differ in practice |
| 4 | Android Chrome, one version back, on a real mid-range device | Real CPU is slower than this session's 4x-throttle approximation in ways that vary by chipset; also the only way to catch real touch-target mis-taps rather than measured pixel sizes |
| 5 | Real campus wifi | Chromium's `Network.emulateNetworkConditions` throttles bandwidth/latency cleanly; real wifi also has packet loss, DNS slowness, and captive-portal-style redirects that a clean throttle doesn't reproduce |
| 6 | WhatsApp share deep link (`wa.me`) on both iOS and Android | Opens the installed app differently per platform (iOS: universal link; Android: intent), and SAA-43's "WhatsApp-first" bet needs a person to actually confirm the app opens with the message pre-filled on both |

None of the six above were tested — they need someone with the actual
devices/browsers, not more scripting from this sandbox. The rest of this
document covers what a Chromium-based Playwright pass against a local
production build (`npm run build && npm run start`) could verify today,
2026-09-25.

---

## Verified today (Chromium, device-emulated viewports)

Tested Landing, Intake, and Guide (India/graduate/future date) at six
viewport presets spanning the realistic range from a small phone to a
large desktop: iPhone SE (375×667), iPhone 14 (390×844), Pixel 7
(412×915), iPad Mini (768×1024), a small laptop (1280×800), and a large
desktop (1920×1080).

**No horizontal scroll at any size.** `document.documentElement.scrollWidth`
matched `clientWidth` exactly on every page at every viewport, including
the narrowest (375px) — consistent with the mobile-first 390px/16px-gutter
baseline `SAA-16` set.

**Touch target sizes.** Every checkbox and thumbs button measured exactly
at or just above the WCAG 2.5.8 floor (24×24 CSS px — not a requirement
for this project's WCAG 2.1 AA target, but a real usability number), and
below the 44×44 px Apple/Google recommend for comfortable mobile tapping:

| Control | Measured | Meets 24×24 (2.5.8 floor) | Meets 44×44 (mobile guidance) |
| --- | --- | --- | --- |
| Step checkbox | 24×24 | Yes (exactly) | No |
| Per-step thumbs (👍/👎) | 29×24 | Yes | No |
| "Notify me" button | 83×32 | Yes | No (height) |

This held at every viewport size tested, including the desktop ones —
these controls don't grow for touch at all. Not a blocking bug (nothing
here is unreachable or mis-sized enough to fail a hard accessibility
check), but worth a product call: enlarging the checkbox and thumbs hit
areas specifically for narrow viewports would make one-handed phone use
more comfortable. Flagging rather than changing unilaterally, since it
touches the visual density of every step card.

**Time to value under throttled network + CPU**, since SAA-54 specifically
calls out "on campus wifi, not just a laptop on fibre." Measured from
clicking "Build my checklist" to the first real step card rendering,
using a Pixel 7 viewport plus Chromium's CDP network/CPU throttling:

| Condition | Time to first step card |
| --- | --- |
| No throttle (baseline) | 107ms |
| Slow 4G (4 Mbps down / 1 Mbps up / 100ms latency) | 858ms |
| Fast 3G (1.6 Mbps down / 750 Kbps up / 150ms latency) | 841ms |
| Fast 3G **+ 4x CPU throttle** (approximating a slower phone chipset) | 936ms |

All four are well under the PRD's "under 2 seconds" target for
pre-generated variants (`docs/prd.md`'s time-to-value row) — including the
combined worst-case simulation. This is a real, if imperfect, proxy for
"mid-range Android on campus wifi" and it's a strong result: the
architecture's cache-read design (no LLM call, no live generation on the
request path) is doing exactly what it was built for.

---

## Still open

- Items 1–6 above need a person with real devices. Suggest borrowing an
  iPhone and a mid-range Android for a short in-person pass rather than
  trying to script around their absence further.
- If the touch-target sizing above is worth acting on, that's a design
  decision for the product owner, not something to change unilaterally
  here.
