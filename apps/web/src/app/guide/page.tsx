"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { resolveBucket } from "@/lib/buckets";
import {
  Guide,
  PHASES,
  ProgramLevel,
  Step,
  StepState,
  effectiveState,
  formatRelativeDate,
  loadGuideForSignature,
  phaseForOffset,
  resolveStepDate,
} from "@/lib/guide";
import { StepStatus, nextStatus, useStepStatus } from "@/lib/progress";

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

function MinimalStepCard({ step, date }: { step: Step; date: Date }) {
  return (
    <li className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-500">
            {formatDate(date)} &middot; {formatRelativeDate(date)}
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
        className="mt-3 inline-block text-sm font-medium text-brand-hover underline underline-offset-2 dark:text-brand"
      >
        {step.where.label} &rarr;
      </a>
    </li>
  );
}

function StepCard({ arrivalDate, step }: { arrivalDate: Date; step: Step }) {
  const date = resolveStepDate(arrivalDate, step);
  const state: StepState = effectiveState(step);
  const [status, setStatus] = useStepStatus(step.id);
  const [whyExpanded, setWhyExpanded] = useState(false);
  const [thanked, setThanked] = useState(false);

  if (state === "no_source") {
    return <MinimalStepCard step={step} date={date} />;
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
        <CheckboxButton status={status} onCycle={() => setStatus(nextStatus(status))} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-500">
              {formatDate(date)} &middot; {formatRelativeDate(date)}
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
                onClick={() => setWhyExpanded((v) => !v)}
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

          {/* Local-only for now: no submission endpoint or event yet
              (SAA-43 feedback flow, SAA-67 Supabase backend). The card
              anatomy calls for thumbs regardless, so this is the UI
              ahead of the wiring. */}
          <div className="mt-3 flex items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-900">
            <span className="text-xs text-zinc-400 dark:text-zinc-600">Was this helpful?</span>
            {thanked ? (
              <span className="text-xs text-zinc-500 dark:text-zinc-500">Thanks for letting us know.</span>
            ) : (
              <>
                <button
                  type="button"
                  aria-label="Yes, this was helpful"
                  onClick={() => setThanked(true)}
                  className="rounded-md px-1.5 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  👍
                </button>
                <button
                  type="button"
                  aria-label="No, this was not helpful"
                  onClick={() => setThanked(true)}
                  className="rounded-md px-1.5 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  👎
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function Timeline({ guide, arrivalDate, isExactMatch }: { guide: Guide; arrivalDate: Date; isExactMatch: boolean }) {
  const stepsByPhase = PHASES.map((phase) => ({
    phase,
    steps: guide.steps
      .filter((s) => phaseForOffset(s.offset_days).key === phase.key)
      .sort((a, b) => a.offset_days - b.offset_days),
  })).filter((group) => group.steps.length > 0);

  return (
    <div className="flex flex-col gap-8">
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
      {stepsByPhase.map(({ phase, steps }) => (
        <section key={phase.key} aria-label={phase.label} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
            {phase.label}
          </h2>
          <ul className="flex flex-col gap-3">
            {steps.map((step) => (
              <StepCard key={step.id} arrivalDate={arrivalDate} step={step} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function GuideView() {
  const searchParams = useSearchParams();
  const [result, setResult] = useState<{ key: string; guide: Guide; isExactMatch: boolean } | null>(null);
  const [notFoundKey, setNotFoundKey] = useState<string | null>(null);

  const citizenshipCode = searchParams.get("c");
  const level = parseLevel(searchParams.get("l"));
  const arrivalDate = parseArrivalDate(searchParams.get("d"));
  const arrivalDateValue = arrivalDate?.getTime() ?? null;
  const isValid = citizenshipCode !== null && arrivalDateValue !== null;
  const requestKey = `${citizenshipCode}|${level}|${arrivalDateValue}`;

  useEffect(() => {
    if (!isValid || !citizenshipCode) return;
    let cancelled = false;
    const bucket = resolveBucket(citizenshipCode);
    loadGuideForSignature(bucket, level).then((loaded) => {
      if (cancelled) return;
      if (!loaded) {
        setNotFoundKey(requestKey);
        return;
      }
      setResult({ key: requestKey, ...loaded });
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
          <Timeline guide={result.guide} arrivalDate={arrivalDate} isExactMatch={result.isExactMatch} />
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
