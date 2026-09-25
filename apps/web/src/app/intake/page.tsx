"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CitizenshipEntry, searchCitizenships } from "@/lib/buckets";
import { track } from "@/lib/analytics";

const TODAY = new Date().toISOString().slice(0, 10);

function IntakeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const level = searchParams.get("level") === "undergraduate" ? "undergraduate" : "graduate";

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CitizenshipEntry | null>(null);
  const [arrivalDate, setArrivalDate] = useState("");
  const [isEstimate, setIsEstimate] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const results = useMemo(() => searchCitizenships(query).slice(0, 8), [query]);
  const canSubmit = selected !== null && arrivalDate.length > 0;

  // Read via refs (not state) inside the unmount cleanup below, so the
  // effect only needs to run once and doesn't re-fire on every keystroke.
  // Refs are synced after render via their own effects, never written
  // during render itself.
  const submittedRef = useRef(false);
  const selectedRef = useRef(selected);
  const arrivalDateRef = useRef(arrivalDate);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    arrivalDateRef.current = arrivalDate;
  }, [arrivalDate]);

  useEffect(() => {
    return () => {
      if (submittedRef.current) return;
      const field = !selectedRef.current ? "citizenship" : !arrivalDateRef.current ? "arrival_date" : null;
      if (field) track("intake_field_abandon", { field });
    };
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !arrivalDate) return;
    submittedRef.current = true;
    const params = new URLSearchParams({
      c: selected.code,
      d: arrivalDate,
      l: level === "undergraduate" ? "undergrad" : "grad",
    });
    if (isEstimate) params.set("e", "1");
    router.push(`/guide?${params.toString()}`);
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12 sm:px-8">
        <header className="flex flex-col gap-2">
          <Link
            href="/"
            className="w-fit text-xs font-medium text-zinc-500 underline underline-offset-2 dark:text-zinc-400"
          >
            &larr; Back
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            A couple of quick questions
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            We use these to show you the right permit and biometrics steps —
            nothing here is shared beyond building your checklist.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label htmlFor="citizenship" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              What&apos;s your citizenship?
            </label>
            <div className="relative">
              <input
                id="citizenship"
                type="text"
                autoComplete="off"
                value={selected ? selected.label : query}
                onChange={(e) => {
                  setSelected(null);
                  setQuery(e.target.value);
                  setShowResults(true);
                }}
                onFocus={() => setShowResults(true)}
                placeholder="Start typing a country..."
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-brand-hover focus-visible:ring-2 focus-visible:ring-brand-hover focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              {showResults && !selected && query.trim().length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
                  {results.length === 0 && (
                    <li className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                      No matches — we&apos;ll use general guidance instead.
                    </li>
                  )}
                  {results.map((entry) => (
                    <li key={entry.code}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(entry);
                          setQuery("");
                          setShowResults(false);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        {entry.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {!selected && query.trim().length === 0 && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Don&apos;t see your country? Pick the closest match — we&apos;ll flag anything that might not fully apply.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="arrival" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              When do you land in Vancouver?
            </label>
            <input
              id="arrival"
              type="date"
              min={TODAY}
              value={arrivalDate}
              onChange={(e) => setArrivalDate(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-brand-hover focus-visible:ring-2 focus-visible:ring-brand-hover focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Your best guess is fine — you can change this later.
            </p>
            <label className="mt-1 flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={isEstimate}
                onChange={(e) => setIsEstimate(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-brand-hover focus:ring-brand-hover dark:border-zinc-700"
              />
              I haven&apos;t booked my flight yet — this is my best guess
            </label>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-xl border border-brand bg-brand px-6 py-3 text-base font-semibold text-brand-foreground transition hover:bg-brand-hover hover:border-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Build my checklist
          </button>
        </form>
      </main>
    </div>
  );
}

export default function IntakePage() {
  return (
    <Suspense fallback={null}>
      <IntakeForm />
    </Suspense>
  );
}
