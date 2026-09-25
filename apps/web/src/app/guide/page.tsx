"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { resolveBucket, signatureString } from "@/lib/buckets";
import {
  Guide,
  PHASES,
  ProgramLevel,
  Step,
  StepState,
  cacheKey,
  daysBetween,
  effectiveState,
  formatRelativeDate,
  loadGuideForSignature,
  phaseForOffset,
  resolveStepDate,
} from "@/lib/guide";
import { StepStatus, nextStatus, useAllStepStatuses, useStepStatus } from "@/lib/progress";
import { computeProfileHash, getSessionId, track } from "@/lib/analytics";
import { loadProfile, saveProfile } from "@/lib/profile";
import { recordVisit } from "@/lib/visits";
import { hasOptedIn, markOptedIn } from "@/lib/reminders";

// Beyond this many days after arrival, the guide is past its stated
// coverage window (docs/prd.md: "roughly six weeks after arrival").
const WELL_PAST_WINDOW_DAYS = 42;

// Bundles what feedback_submitted needs (docs/prd.md's "Feedback payload")
// so it doesn't have to be threaded as three separate props through
// Timeline -> ReviewStrip -> StepCard and Timeline -> FloatingRatingButton.
interface FeedbackContext {
  profileHash: string | null;
  contentVersion: number;
  guideLoadedAt: number;
}

function secondsSinceGeneration(ctx: FeedbackContext): number {
  return Math.round((Date.now() - ctx.guideLoadedAt) / 1000);
}

function parseLevel(raw: string | null): ProgramLevel {
  return raw === "undergrad" || raw === "undergraduate" ? "undergraduate" : "graduate";
}

function parseArrivalDate(raw: string | null): Date | null {
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
}

// YYYY-MM-DD in local time, matching the shape parseArrivalDate reads back
// (`${raw}T00:00:00`) -- toISOString() would shift by the runtime's UTC
// offset instead of round-tripping the same calendar date.
function toDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ResolvingSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Building your checklist">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="h-3 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="mt-3 h-4 w-3/4 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="mt-2 h-3 w-1/2 rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}

const CHECKBOX_LABEL: Record<StepStatus, string> = {
  not_done: "Mark as done",
  done: "Mark as not applicable",
  not_applicable: "Mark as not done",
};

// SAA-43's remaining scope: thumbs-down reason chips (multi-select, docs/prd.md's
// "Feedback payload" reason[]). Values are the analytics-facing slugs, labels are
// the displayed chip text. "housing" exists because the PRD's own risk table
// calls out tracking housing complaints through this exact mechanism.
const FEEDBACK_REASONS = [
  { value: "inaccurate", label: "Inaccurate or outdated" },
  { value: "confusing", label: "Confusing or hard to follow" },
  { value: "missing_info", label: "Missing information I needed" },
  { value: "not_relevant", label: "Not relevant to my situation" },
  { value: "housing", label: "Wish this covered housing" },
  { value: "other", label: "Something else" },
] as const;

// Shared by the per-step and overall thumbs-down flows. Submission is
// deferred until this is filled out (or explicitly skipped), so every
// negative feedback_submitted event carries at least an attempted reason.
function ReasonChipPicker({ onSubmit }: { onSubmit: (reasons: string[], text: string) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");

  function toggle(value: string) {
    setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {FEEDBACK_REASONS.map((reason) => (
          <button
            key={reason.value}
            type="button"
            aria-pressed={selected.includes(reason.value)}
            onClick={() => toggle(reason.value)}
            className={`rounded-full border px-2 py-1 text-xs transition ${
              selected.includes(reason.value)
                ? "border-brand bg-brand text-brand-foreground"
                : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
            }`}
          >
            {reason.label}
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Anything else? (optional)"
        rows={2}
        className="w-full resize-none rounded-lg border border-zinc-300 bg-white p-2 text-xs text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      />
      <button
        type="button"
        onClick={() => onSubmit(selected, text.trim())}
        className="w-fit rounded-md bg-brand px-3 py-1 text-xs font-medium text-brand-foreground"
      >
        Submit
      </button>
    </div>
  );
}

// Sharing a generic invite to the app, not the sender's own filled-in guide
// URL: the guide URL carries the sharer's own citizenship/date/level, which
// is very unlikely to also be correct for whoever they send it to (unlike
// the profile-in-URL handoff CLAUDE.md describes for a student's own
// desktop<->mobile use), and a mismatched profile risks a recipient landing
// on a guide that doesn't fit them.
function buildWhatsAppShareUrl(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const message = `I've been using Una to keep track of everything for moving to UBC as an international student — study permit, SIN, MSP, all in one place with real sources. Worth a look: ${origin}`;
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

function CheckboxButton({ status, onCycle }: { status: StepStatus; onCycle: () => void }) {
  const base = "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold transition";
  const style =
    status === "done"
      ? "border-brand bg-brand text-brand-foreground"
      : status === "not_applicable"
        ? "border-zinc-300 bg-zinc-100 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
        : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950";

  return (
    <button type="button" onClick={onCycle} aria-label={CHECKBOX_LABEL[status]} className={`${base} ${style}`}>
      {status === "done" ? "✓" : status === "not_applicable" ? "–" : ""}
    </button>
  );
}

function SourceBlock({ step, stale }: { step: Step; stale: boolean }) {
  if (step.sources.length === 0) return null;
  return (
    <div
      className={`mt-3 flex flex-col gap-1 rounded-lg p-2 text-xs ${
        stale
          ? "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          : "text-zinc-500 dark:text-zinc-500"
      }`}
    >
      {step.sources.map((source, i) => (
        <a
          key={`${source.url}-${i}`}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:no-underline"
        >
          {source.organisation} — {source.title}
          {source.last_verified ? ` (checked ${source.last_verified})` : ""}
        </a>
      ))}
    </div>
  );
}

function EstimateTag() {
  return (
    <span className="w-fit rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500">
      Estimated
    </span>
  );
}

function MinimalStepCard({ step, date, isEstimated }: { step: Step; date: Date; isEstimated: boolean }) {
  return (
    <li className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-500">
            {formatDate(date)} &middot; {formatRelativeDate(date)}
            {isEstimated && <EstimateTag />}
          </span>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{step.title}</h3>
        </div>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          Source pending
        </span>
      </div>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-500">
        We don&apos;t have a source we&apos;re confident enough in yet for the details here.
      </p>
      <a
        href={step.where.url || undefined}
        target="_blank"
        rel="noreferrer"
        onClick={() => track("outbound_click", { step_id: step.id, host: step.where.host })}
        className="mt-3 inline-block text-sm font-medium text-brand-hover underline underline-offset-2 dark:text-brand"
      >
        {step.where.label} &rarr;
      </a>
    </li>
  );
}

function StepCard({
  arrivalDate,
  step,
  isEstimated,
  feedbackContext,
  profileKey,
}: {
  arrivalDate: Date;
  step: Step;
  isEstimated: boolean;
  feedbackContext: FeedbackContext;
  profileKey: string;
}) {
  const date = resolveStepDate(arrivalDate, step);
  const state: StepState = effectiveState(step);
  const [status, setStatus] = useStepStatus(profileKey, step.id);
  const [whyExpanded, setWhyExpanded] = useState(false);
  const [thumbsPhase, setThumbsPhase] = useState<"idle" | "reasons" | "done">("idle");

  if (state === "no_source") {
    return <MinimalStepCard step={step} date={date} isEstimated={isEstimated} />;
  }

  const isStale = state === "stale";
  const isNotSpecific = state === "not_specific";
  const isDone = status === "done";

  return (
    <li
      className={`rounded-xl border p-4 ${
        isStale ? "border-amber-300 dark:border-amber-800" : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      {isStale && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Stale — this source hasn&apos;t been rechecked recently. The step is still shown, but double-check the
          official link below.
        </div>
      )}

      <div className="flex items-start gap-3">
        <CheckboxButton
          status={status}
          onCycle={() => {
            const next = nextStatus(status);
            setStatus(next);
            track("step_checked", { step_id: step.id, status: next });
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-500">
              {formatDate(date)} &middot; {formatRelativeDate(date)}
              {isEstimated && <EstimateTag />}
            </span>
            <h3
              className={`text-base font-semibold ${
                isDone ? "text-zinc-400 line-through dark:text-zinc-600" : "text-zinc-900 dark:text-zinc-50"
              }`}
            >
              {step.title}
            </h3>
          </div>

          {isNotSpecific && (
            <span className="mt-1 inline-block w-fit rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              Not specific to your country or program — general guidance
            </span>
          )}

          <div className="mt-2">
            <p className={`text-sm text-zinc-700 dark:text-zinc-300 ${whyExpanded ? "" : "line-clamp-2"}`}>
              {step.why}
            </p>
            {step.why.length > 100 && (
              <button
                type="button"
                onClick={() => {
                  const next = !whyExpanded;
                  setWhyExpanded(next);
                  if (next) track("step_expanded", { step_id: step.id, state });
                }}
                aria-expanded={whyExpanded}
                className="mt-1 text-xs font-medium text-brand-hover dark:text-brand"
              >
                {whyExpanded ? "Show less" : "Read more"}
              </button>
            )}
          </div>

          {step.prerequisites.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-500">What you need</h4>
              <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-xs text-zinc-600 dark:text-zinc-400">
                {step.prerequisites.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500 dark:text-zinc-500">
            {step.cost && (
              <div>
                <dt className="inline font-medium">Cost: </dt>
                <dd className="inline">{step.cost}</dd>
              </div>
            )}
            {step.time_estimate && (
              <div>
                <dt className="inline font-medium">Takes: </dt>
                <dd className="inline">{step.time_estimate}</dd>
              </div>
            )}
          </dl>

          {step.office && (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
              <span className="font-medium">Who handles this: </span>
              {step.office.name}
              {step.office.note ? ` — ${step.office.note}` : ""}
            </p>
          )}

          <a
            href={step.where.url}
            target="_blank"
            rel="noreferrer"
            onClick={() => track("outbound_click", { step_id: step.id, host: step.where.host })}
            className="mt-3 inline-block text-sm font-medium text-brand-hover underline underline-offset-2 dark:text-brand"
          >
            {step.where.label} ({step.where.host}) &rarr;
          </a>

          <SourceBlock step={step} stale={isStale} />

          {step.applies_to_rules.length > 0 && (
            <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-600">
              <span className="font-medium">Why this is in your guide: </span>
              {step.applies_to_rules[0]}
            </p>
          )}

          <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-900">
            {thumbsPhase === "done" ? (
              <span className="text-xs text-zinc-500 dark:text-zinc-500">Thanks for letting us know.</span>
            ) : thumbsPhase === "reasons" ? (
              <ReasonChipPicker
                onSubmit={(reasons, text) => {
                  setThumbsPhase("done");
                  track("feedback_submitted", {
                    scope: "step",
                    value: "down",
                    reason: reasons,
                    text: text || undefined,
                    step_id: step.id,
                    profile_hash: feedbackContext.profileHash,
                    content_version: feedbackContext.contentVersion,
                    seconds_since_generation: secondsSinceGeneration(feedbackContext),
                  });
                }}
              />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 dark:text-zinc-600">Was this helpful?</span>
                <button
                  type="button"
                  aria-label="Yes, this was helpful"
                  onClick={() => {
                    setThumbsPhase("done");
                    track("feedback_submitted", {
                      scope: "step",
                      value: "up",
                      step_id: step.id,
                      profile_hash: feedbackContext.profileHash,
                      content_version: feedbackContext.contentVersion,
                      seconds_since_generation: secondsSinceGeneration(feedbackContext),
                    });
                  }}
                  className="rounded-md px-1.5 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  👍
                </button>
                <button
                  type="button"
                  aria-label="No, this was not helpful"
                  onClick={() => setThumbsPhase("reasons")}
                  className="rounded-md px-1.5 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  👎
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

// SAA-43: shown on first deep scroll or first checkbox tick, never on
// generation -- gating this on "all steps done" alone (the PRD's
// guide-level state) would mean most users, who never finish every step,
// never see it, biasing the helpful-rate metric toward only the most
// thorough users. `allDone` still gets its own congratulatory framing
// when it applies, since finishing everything really is worth noting.
//
// Floating action button rather than an inline banner (design decision
// 2026-09-25, docs/decisions.md): the trigger is "first deep scroll," so
// by definition the user has already scrolled past the top of the page
// by the time this fires -- a banner inserted there appears behind them,
// exactly where they won't see it. A `position: fixed` corner button is
// visible regardless of scroll position, on both mobile and desktop
// (mobile especially: it costs no permanent vertical space the way a
// sticky header would on an already-small screen, and a bottom corner
// sits in the natural one-handed thumb zone).
//
// If a future feature (reminder opt-in, share) also wants a floating
// corner affordance, coordinate placement with this one (e.g. stack
// vertically) rather than overlapping the same corner.
// "reasons" (thumbs down) and "share" (thumbs up) both follow the initial
// rating -- reason chips turn a complaint into a fix (docs/prd.md), and a
// WhatsApp-first share is the PRD's own bet on this cohort's actual
// word-of-mouth channel (their survey named WhatsApp over Reddit 4:2).
type RatingPhase = "rate" | "reasons" | "share" | "done";

function FloatingRatingButton({ allDone, feedbackContext }: { allDone: boolean; feedbackContext: FeedbackContext }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<RatingPhase>("rate");

  return (
    <div className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-end gap-2">
      {open && (
        <div
          role="dialog"
          aria-label="Rate this checklist"
          className="w-64 rounded-xl border border-brand bg-white p-4 text-sm text-zinc-800 shadow-lg dark:bg-zinc-950 dark:text-zinc-100"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">
              {allDone
                ? "You've been through your whole checklist. Nice work."
                : "How's this checklist working for you so far?"}
            </p>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="shrink-0 text-lg leading-none text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              &times;
            </button>
          </div>
          <div className="mt-2">
            {phase === "done" ? (
              <span className="text-xs text-zinc-600 dark:text-zinc-400">Thanks!</span>
            ) : phase === "reasons" ? (
              <ReasonChipPicker
                onSubmit={(reasons, text) => {
                  setPhase("done");
                  track("feedback_submitted", {
                    scope: "overall",
                    value: "down",
                    reason: reasons,
                    text: text || undefined,
                    profile_hash: feedbackContext.profileHash,
                    content_version: feedbackContext.contentVersion,
                    seconds_since_generation: secondsSinceGeneration(feedbackContext),
                  });
                }}
              />
            ) : phase === "share" ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Know someone else moving to UBC? Send them Una.
                </p>
                <div className="flex items-center gap-3">
                  <a
                    href={buildWhatsAppShareUrl()}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => track("share_initiated", { channel: "whatsapp" })}
                    className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-brand-foreground"
                  >
                    Share on WhatsApp
                  </a>
                  <button
                    type="button"
                    onClick={() => setPhase("done")}
                    className="text-xs text-zinc-400 underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-200"
                  >
                    No thanks
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-600 dark:text-zinc-400">Rate it overall</span>
                <button
                  type="button"
                  aria-label="Overall, this was helpful"
                  onClick={() => {
                    setPhase("share");
                    track("feedback_submitted", {
                      scope: "overall",
                      value: "up",
                      profile_hash: feedbackContext.profileHash,
                      content_version: feedbackContext.contentVersion,
                      seconds_since_generation: secondsSinceGeneration(feedbackContext),
                    });
                  }}
                  className="rounded-md px-1.5 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  👍
                </button>
                <button
                  type="button"
                  aria-label="Overall, this was not helpful"
                  onClick={() => setPhase("reasons")}
                  className="rounded-md px-1.5 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  👎
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <button
        type="button"
        aria-label={open ? "Close feedback" : "Rate this checklist"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-12 items-center justify-center rounded-full border border-brand bg-brand text-xl shadow-lg transition motion-safe:hover:scale-105"
      >
        {phase === "rate" ? "⭐" : "✓"}
      </button>
    </div>
  );
}

function ReviewStrip({
  phase,
  steps,
  arrivalDate,
  isEstimated,
  feedbackContext,
  profileKey,
}: {
  phase: (typeof PHASES)[number];
  steps: Step[];
  arrivalDate: Date;
  isEstimated: boolean;
  feedbackContext: FeedbackContext;
  profileKey: string;
}) {
  const dates = steps.map((s) => resolveStepDate(arrivalDate, s));
  const earliest = formatDate(dates.reduce((a, b) => (a < b ? a : b)));
  const latest = formatDate(dates.reduce((a, b) => (a > b ? a : b)));
  const range = earliest === latest ? earliest : `${earliest} – ${latest}`;

  return (
    <details className="rounded-xl border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm text-zinc-600 marker:content-none dark:text-zinc-400">
        <span className="font-medium text-zinc-800 dark:text-zinc-200">{phase.label}</span> — {steps.length} step
        {steps.length === 1 ? "" : "s"}, {range}
      </summary>
      <ul className="flex flex-col gap-3 border-t border-zinc-100 p-4 pt-4 dark:border-zinc-900">
        {steps.map((step) => (
          <StepCard
            key={step.id}
            arrivalDate={arrivalDate}
            step={step}
            isEstimated={isEstimated}
            feedbackContext={feedbackContext}
            profileKey={profileKey}
          />
        ))}
      </ul>
    </details>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// SAA-45: opt-in capture only -- actual sending is a separate, still-gated
// track (SAA-24, the product owner's sending domain + unsubscribe
// mechanism). One opt-in covers every future deadline in this specific
// guide (no per-step selection), matching docs/prd.md's "email deadline
// reminders" framing rather than a step-by-step subscription model.
function ReminderOptIn({ guide, arrivalDate, profileKey }: { guide: Guide; arrivalDate: Date; profileKey: string }) {
  const [optedIn, setOptedIn] = useState(() => hasOptedIn(profileKey));
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");

  if (optedIn) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        You&apos;re signed up for email reminders before upcoming deadlines.
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email)) {
      setStatus("error");
      return;
    }
    setStatus("submitting");
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          bucket_signature: guide.bucket_signature,
          program_level: guide.program_level,
          arrival_date: toDateParam(arrivalDate),
          content_version: guide.content_version,
        }),
      });
      if (!res.ok) throw new Error("request failed");
      markOptedIn(profileKey);
      setOptedIn(true);
      track("reminder_opt_in");
    } catch {
      setStatus("error");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <label htmlFor="reminder-email" className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
        Want an email reminder before each deadline?
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="reminder-email"
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === "error") setStatus("idle");
          }}
          placeholder="you@example.com"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground disabled:opacity-50"
        >
          {status === "submitting" ? "Signing up…" : "Notify me"}
        </button>
      </div>
      {status === "error" && (
        <p className="text-xs text-red-600 dark:text-red-400">
          Something went wrong — check your email address and try again.
        </p>
      )}
    </form>
  );
}

function Timeline({
  guide,
  arrivalDate,
  isExactMatch,
  isEstimated,
  feedbackContext,
  hasContentChanged,
}: {
  guide: Guide;
  arrivalDate: Date;
  isExactMatch: boolean;
  isEstimated: boolean;
  feedbackContext: FeedbackContext;
  hasContentChanged: boolean;
}) {
  const today = new Date();
  // Checkbox state is scoped to the full profile -- bucket + level +
  // arrival date, not just the guide's own content cache key (see
  // progress.ts) -- so two students sharing the same cached guide, or a
  // shared link landing someone on the same bucket+level with a different
  // arrival date, never see each other's progress.
  const profileKey = `${cacheKey(guide.bucket_signature, guide.program_level)}::${arrivalDate.getTime()}`;

  const stepsByPhase = PHASES.map((phase) => ({
    phase,
    steps: guide.steps
      .filter((s) => phaseForOffset(s.offset_days).key === phase.key)
      .sort((a, b) => a.offset_days - b.offset_days),
  })).filter((group) => group.steps.length > 0);

  const daysSinceArrival = daysBetween(arrivalDate, today);
  const isWellPastWindow = daysSinceArrival > WELL_PAST_WINDOW_DAYS;

  const checkboxStepIds = guide.steps.filter((s) => effectiveState(s) !== "no_source").map((s) => s.id);
  const statuses = useAllStepStatuses(profileKey, checkboxStepIds);
  const allDone =
    checkboxStepIds.length > 0 &&
    checkboxStepIds.every((id) => statuses[id] === "done" || statuses[id] === "not_applicable");
  const hasCheckedAStep = checkboxStepIds.some((id) => statuses[id] !== "not_done");

  // "First deep scroll" — both this and hasCheckedAStep only ever go
  // false -> true, so once the rating card appears it never disappears.
  const [hasScrolledDeep, setHasScrolledDeep] = useState(false);
  useEffect(() => {
    function onScroll() {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable > 0 && window.scrollY / scrollable > 0.5) {
        setHasScrolledDeep(true);
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const showRatingCard = allDone || hasCheckedAStep || hasScrolledDeep;

  return (
    <>
      {showRatingCard && <FloatingRatingButton allDone={allDone} feedbackContext={feedbackContext} />}
      <div className="flex flex-col gap-8">
        {hasContentChanged && (
          <div className="rounded-xl border border-brand bg-brand/10 p-4 text-sm text-zinc-800 dark:text-zinc-100">
            We&apos;ve updated this checklist since your last visit — take a look at what&apos;s changed below.
          </div>
        )}
        {!isExactMatch && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Your exact situation isn&apos;t covered yet — showing the closest match we have.
          </div>
        )}
        {guide.program_level === "undergraduate" && (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            This path is newer and less tested than the graduate path — let us know if something looks off.
          </div>
        )}
        {isWellPastWindow && (
          <div className="rounded-xl border border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            It&apos;s been over six weeks since you landed — you&apos;re past the window this checklist is built for,
            so some of what&apos;s below may no longer be relevant.
          </div>
        )}
        {isEstimated && (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            Dates below are estimated from the arrival date you guessed — once you book your flight, come back and
            update it for exact dates.
          </div>
        )}
        {/* Not worth offering reminders once the guide is past its own
            coverage window -- there's nothing upcoming left to remind
            anyone about. */}
        {!isWellPastWindow && <ReminderOptIn guide={guide} arrivalDate={arrivalDate} profileKey={profileKey} />}
        {stepsByPhase.map(({ phase, steps }) => {
          const isPastPhase = steps.every((s) => daysBetween(resolveStepDate(arrivalDate, s), today) > 0);
          if (isPastPhase) {
            return (
              <ReviewStrip
                key={phase.key}
                phase={phase}
                steps={steps}
                arrivalDate={arrivalDate}
                isEstimated={isEstimated}
                feedbackContext={feedbackContext}
                profileKey={profileKey}
              />
            );
          }
          return (
            <section key={phase.key} aria-label={phase.label} className="flex flex-col gap-3">
              <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                {phase.label}
              </h2>
              <ul className="flex flex-col gap-3">
                {steps.map((step) => (
                  <StepCard
                    key={step.id}
                    arrivalDate={arrivalDate}
                    step={step}
                    isEstimated={isEstimated}
                    feedbackContext={feedbackContext}
                    profileKey={profileKey}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function GuideView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [result, setResult] = useState<{ key: string; guide: Guide; isExactMatch: boolean } | null>(null);
  const [notFoundKey, setNotFoundKey] = useState<string | null>(null);
  const [feedbackMeta, setFeedbackMeta] = useState<{ key: string; profileHash: string | null; loadedAt: number } | null>(
    null
  );
  const [changeInfo, setChangeInfo] = useState<{ key: string; versionDelta: number } | null>(null);

  const urlCitizenship = searchParams.get("c");
  const urlLevel = searchParams.get("l");
  const urlDate = searchParams.get("d");
  const urlEstimate = searchParams.get("e");
  const hasUrlProfile = urlCitizenship !== null && urlDate !== null;

  // URL params -> localStorage -> fresh start (CLAUDE.md's architectural
  // constraint), never the other way -- localStorage is only ever
  // consulted when the URL is missing pieces, so a shared link always
  // builds the recipient their own guide rather than handing them
  // whichever profile is sitting in their own browser's storage.
  const stored = hasUrlProfile ? null : loadProfile();

  const citizenshipCode = urlCitizenship ?? stored?.c ?? null;
  const level = parseLevel(urlLevel ?? stored?.l ?? null);
  const rawDate = urlDate ?? stored?.d ?? null;
  const arrivalDate = parseArrivalDate(rawDate);
  const isEstimated = (urlEstimate ?? stored?.e) === "1";

  const arrivalDateValue = arrivalDate?.getTime() ?? null;
  const isValid = citizenshipCode !== null && arrivalDateValue !== null;
  const requestKey = `${citizenshipCode}|${level}|${arrivalDateValue}`;

  // Keeps the URL and localStorage in sync with whatever profile actually
  // resolved -- the URL because "profile lives in the URL" is what makes
  // this shareable, localStorage because that's what makes a bare
  // `/guide` visit resolve to something instead of "fresh start".
  // Self-limiting: once the URL carries the profile, hasUrlProfile flips
  // true and this stops replacing it.
  useEffect(() => {
    if (!isValid || !citizenshipCode || !rawDate) return;
    const levelParam = urlLevel ?? stored?.l ?? "grad";
    saveProfile({ c: citizenshipCode, d: rawDate, l: levelParam, e: isEstimated ? "1" : undefined });
    if (!hasUrlProfile) {
      const params = new URLSearchParams({ c: citizenshipCode, d: rawDate, l: levelParam });
      if (isEstimated) params.set("e", "1");
      router.replace(`/guide?${params.toString()}`);
    }
  }, [isValid, citizenshipCode, rawDate, isEstimated, hasUrlProfile, urlLevel, stored?.l, router]);

  useEffect(() => {
    if (!isValid || !citizenshipCode) return;
    let cancelled = false;
    const startedAt = performance.now();
    const bucket = resolveBucket(citizenshipCode);
    loadGuideForSignature(bucket, level).then(async (loaded) => {
      if (cancelled) return;
      if (!loaded) {
        setNotFoundKey(requestKey);
        return;
      }
      setResult({ key: requestKey, ...loaded });
      const loadedAt = Date.now(); // fine here — this runs in a .then() callback, not during render
      setFeedbackMeta({ key: requestKey, profileHash: null, loadedAt });

      // Return-visit resolution (docs/prd.md's guide-level "return visit"
      // state): compares against the last content_version this browser
      // saw for this specific guide, fires the retention event either
      // way, and surfaces a change banner only when content actually
      // moved forward.
      const visitCacheKey = cacheKey(loaded.guide.bucket_signature, loaded.guide.program_level);
      const visitInfo = recordVisit(visitCacheKey, loaded.guide.content_version);
      if (visitInfo) {
        setChangeInfo({ key: requestKey, versionDelta: visitInfo.versionDelta });
        track("return_visit", {
          days_since_last: visitInfo.daysSinceLast,
          version_delta: visitInfo.versionDelta,
        });
      }

      const sessionId = getSessionId();
      const profileHash = sessionId
        ? await computeProfileHash(`${signatureString(bucket)}|${level}`, sessionId)
        : null;
      if (cancelled) return;
      setFeedbackMeta({ key: requestKey, profileHash, loadedAt });

      track("guide_generated", {
        profile_hash: profileHash,
        content_version: loaded.guide.content_version,
        latency_ms: Math.round(performance.now() - startedAt),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [isValid, citizenshipCode, level, requestKey]);

  const status: "resolving" | "ready" | "not_found" =
    result?.key === requestKey ? "ready" : notFoundKey === requestKey ? "not_found" : "resolving";

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12 sm:px-8">
        <Link
          href="/"
          className="w-fit text-xs font-medium text-zinc-500 underline underline-offset-2 dark:text-zinc-400"
        >
          &larr; Start over
        </Link>

        {!isValid && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Missing some details.{" "}
            <Link href="/intake" className="underline underline-offset-2">
              Go back and fill in the form
            </Link>
            .
          </p>
        )}

        {isValid && status === "resolving" && <ResolvingSkeleton />}

        {isValid && status === "not_found" && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            We don&apos;t have a checklist ready for this yet — check back soon.
          </p>
        )}

        {isValid && status === "ready" && result && arrivalDate && (
          <Timeline
            guide={result.guide}
            arrivalDate={arrivalDate}
            isExactMatch={result.isExactMatch}
            isEstimated={isEstimated}
            feedbackContext={{
              // feedbackMeta is set in the same batch as `result` (see the
              // effect above), so by the time `result` renders with a
              // matching key, feedbackMeta does too — this fallback is
              // just for TypeScript, not an expected runtime path, so it
              // uses a static sentinel rather than calling Date.now()
              // during render (impure — not allowed in a component body).
              profileHash: feedbackMeta?.key === requestKey ? feedbackMeta.profileHash : null,
              contentVersion: result.guide.content_version,
              guideLoadedAt: feedbackMeta?.key === requestKey ? feedbackMeta.loadedAt : 0,
            }}
            hasContentChanged={changeInfo?.key === requestKey && changeInfo.versionDelta > 0}
          />
        )}
      </main>
    </div>
  );
}

export default function GuidePage() {
  return (
    <Suspense fallback={null}>
      <GuideView />
    </Suspense>
  );
}
