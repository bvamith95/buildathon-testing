// Guide loading: a cache read against static JSON published by the
// pipeline (architecture.md §4) — never a live generation call. Also
// implements the unmatched-signature nearest-match fallback decided in
// docs/decisions.md item 14 / Linear SAA-22.

import { BucketSignature, signatureString } from "./buckets";

export type StepState = "verified" | "stale" | "no_source" | "not_specific";
export type ProgramLevel = "graduate" | "undergraduate";

export interface Source {
  organisation: string;
  title: string;
  url: string;
  last_verified: string | null;
}

export interface WhereToDo {
  label: string;
  host: string;
  url: string;
}

export interface Office {
  name: string;
  note: string | null;
}

export interface Step {
  id: string;
  phase: string;
  offset_days: number;
  title: string;
  why: string;
  prerequisites: string[];
  cost: string | null;
  time_estimate: string | null;
  where: WhereToDo;
  office: Office | null;
  sources: Source[];
  applies_to_rules: string[];
  confidence: number;
  state: StepState;
}

export interface Guide {
  content_version: number;
  program_level: ProgramLevel;
  bucket_signature: string;
  steps: Step[];
  generated_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

// Matches pipeline/run_pilot.py's PILOT_STEPS phase keys exactly.
// shortLabel is for the journey stepper, where five full labels won't fit
// side by side at phone width.
export const PHASES: { key: string; label: string; shortLabel: string; minOffset: number; maxOffset: number }[] = [
  { key: "after_your_offer", label: "After you accept your offer", shortLabel: "Accept offer", minOffset: -Infinity, maxOffset: -60 },
  { key: "preparing_to_move", label: "Preparing to move", shortLabel: "Prepare", minOffset: -59, maxOffset: -1 },
  { key: "landing_day", label: "Landing day", shortLabel: "Landing", minOffset: 0, maxOffset: 0 },
  { key: "first_two_weeks", label: "Your first two weeks", shortLabel: "Weeks 1–2", minOffset: 1, maxOffset: 14 },
  { key: "weeks_three_and_four", label: "Weeks three and four", shortLabel: "Weeks 3–4", minOffset: 15, maxOffset: 30 },
];

export function phaseForOffset(offsetDays: number) {
  return (
    PHASES.find((p) => offsetDays >= p.minOffset && offsetDays <= p.maxOffset) ??
    PHASES[PHASES.length - 1]
  );
}

/** arrival_date + offset_days, clamped to business days when a government
 * office is involved — architecture.md §5. Government-office steps are
 * approximated here as anything with a non-null `office` or a `.ca`
 * government host; this clamps forward to the next Monday. */
export function resolveStepDate(arrivalDate: Date, step: Step): Date {
  const date = new Date(arrivalDate);
  date.setDate(date.getDate() + step.offset_days);

  const isGovernmentStep = step.office !== null || /gc\.ca|canada\.ca|gov\.bc\.ca/.test(step.where.host);
  if (isGovernmentStep) {
    const day = date.getDay();
    if (day === 6) date.setDate(date.getDate() + 2);
    if (day === 0) date.setDate(date.getDate() + 1);
  }
  return date;
}

// Recheck window in days before a source counts as stale, mirroring
// pipeline/landfall_pipeline/config.py's RECHECK_WINDOW_DAYS (30 for
// immigration content, 90 for everything else — docs/decisions.md,
// "Set the recheck window"). Keyed by organisation since Source has no
// separate category field.
const RECHECK_WINDOW_DAYS: Record<string, number> = {
  IRCC: 30,
};
const DEFAULT_RECHECK_WINDOW_DAYS = 90;

/** The PRD's "Stale" state (docs/prd.md, "Content states") isn't baked
 * into the published step — it's a function of today's date against the
 * source's last_verified date, so this is evaluated at render time
 * rather than requiring a republish. Only a step with real sourced
 * content can go stale; no_source has nothing to check. */
export function effectiveState(step: Step, today: Date = new Date()): StepState {
  if (step.state !== "verified" && step.state !== "not_specific") return step.state;
  const primarySource = step.sources[0];
  if (!primarySource?.last_verified) return step.state;

  const windowDays = RECHECK_WINDOW_DAYS[primarySource.organisation] ?? DEFAULT_RECHECK_WINDOW_DAYS;
  const lastVerified = new Date(`${primarySource.last_verified}T00:00:00`);
  const ageDays = Math.floor((today.getTime() - lastVerified.getTime()) / (1000 * 60 * 60 * 24));
  return ageDays > windowDays ? "stale" : step.state;
}

/** Whole days from `from` to `to`, ignoring time of day — positive when
 * `to` is later. Shared by the relative-date label, the past-phase
 * collapsing, and the well-past-window guide-level state (SAA-41), so
 * all three agree on what "today" means. */
export function daysBetween(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

/** Absolute + relative together, e.g. "Wed, May 27 · in 45 days"
 * (docs/prd.md: "the relative framing is what makes it feel personal"). */
export function formatRelativeDate(date: Date, today: Date = new Date()): string {
  const diffDays = daysBetween(today, date);

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays === -1) return "yesterday";
  if (diffDays > 1) return `in ${diffDays} days`;
  return `${Math.abs(diffDays)} days ago`;
}

export function cacheKey(bucketSignature: string, level: ProgramLevel): string {
  return `${bucketSignature}__${level}`;
}

async function fetchGuide(bucketSignature: string, level: ProgramLevel): Promise<Guide | null> {
  try {
    const res = await fetch(`/guides/${cacheKey(bucketSignature, level)}.json`);
    if (!res.ok) return null;
    return (await res.json()) as Guide;
  } catch {
    return null;
  }
}

// The full manifest of bucket signatures with a published guide, per
// program level. Small and static at this scale (architecture.md §8) —
// hand-maintained here until there are enough guides to warrant
// generating this list at build time.
const PUBLISHED_SIGNATURES: Record<ProgramLevel, string[]> = {
  graduate: [
    "visa_required-required-required-country_programme_variant-restricted",
    "eta-exempt-not_required-standard-major",
    "visa_required-required-not_required-country_programme_variant-restricted",
    "eta-required-required-standard-major",
    "eta-required-not_required-standard-major",
    "visa_required-required-not_required-standard-major",
    "visa_required-required-required-standard-major",
  ],
  undergraduate: [
    "visa_required-required-required-country_programme_variant-restricted",
    "eta-exempt-not_required-standard-major",
    "visa_required-required-not_required-country_programme_variant-restricted",
    "eta-required-required-standard-major",
    "eta-required-not_required-standard-major",
    "visa_required-required-not_required-standard-major",
    "visa_required-required-required-standard-major",
  ],
};

const DIMENSION_WEIGHTS: [keyof BucketSignature, number][] = [
  ["entry_document", 16],
  ["biometrics", 8],
  ["medical_exam", 4],
  ["funds_evidence", 2],
  ["currency_corridor", 1],
];

function parseSignature(sig: string): Partial<BucketSignature> {
  const [entry_document, biometrics, medical_exam, funds_evidence, currency_corridor] = sig.split("-") as [
    BucketSignature["entry_document"],
    BucketSignature["biometrics"],
    BucketSignature["medical_exam"],
    BucketSignature["funds_evidence"],
    BucketSignature["currency_corridor"],
  ];
  return { entry_document, biometrics, medical_exam, funds_evidence, currency_corridor };
}

/** Nearest-match algorithm from docs/decisions.md item 14 / Linear
 * SAA-22: weighted comparison across the 5 bucket dimensions, heavier
 * weight on dimensions that gate whether whole steps exist. */
export function nearestSignature(target: BucketSignature, level: ProgramLevel): string | null {
  const candidates = PUBLISHED_SIGNATURES[level];
  if (candidates.length === 0) return null;

  let best: { sig: string; score: number } | null = null;
  for (const sig of candidates) {
    const parsed = parseSignature(sig);
    let score = 0;
    for (const [dimension, weight] of DIMENSION_WEIGHTS) {
      if (parsed[dimension] === target[dimension]) score += weight;
    }
    if (!best || score > best.score || (score === best.score && sig < best.sig)) {
      best = { sig, score };
    }
  }
  return best?.sig ?? null;
}

export interface GuideResult {
  guide: Guide;
  isExactMatch: boolean;
}

export async function loadGuideForSignature(
  target: BucketSignature,
  level: ProgramLevel
): Promise<GuideResult | null> {
  const exactSig = signatureString(target);
  const exact = await fetchGuide(exactSig, level);
  if (exact) return { guide: exact, isExactMatch: true };

  const nearest = nearestSignature(target, level);
  if (!nearest) return null;
  const guide = await fetchGuide(nearest, level);
  if (!guide) return null;
  return { guide, isExactMatch: false };
}
