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
export const PHASES: { key: string; label: string; minOffset: number; maxOffset: number }[] = [
  { key: "after_your_offer", label: "After your offer", minOffset: -Infinity, maxOffset: -60 },
  { key: "preparing_to_move", label: "Preparing to move", minOffset: -59, maxOffset: -1 },
  { key: "landing_day", label: "Landing day", minOffset: 0, maxOffset: 0 },
  { key: "first_two_weeks", label: "Your first two weeks", minOffset: 1, maxOffset: 14 },
  { key: "weeks_three_and_four", label: "Weeks three and four", minOffset: 15, maxOffset: 30 },
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
  graduate: ["visa_required-required-required-country_programme_variant-restricted"],
  undergraduate: [],
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
