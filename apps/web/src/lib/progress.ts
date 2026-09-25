// Three-valued step checkbox state, keyed on (guide cache_key, STEP.id) —
// STEP.id alone per the CLAUDE.md architectural constraint (never array
// position, so a content update that reshuffles steps can't untick or
// misapply the wrong step for a returning user), but scoped to the
// specific guide too: step ids like "study-permit-apply" are the same
// literal string across every published bucket by design (the step
// vocabulary is shared, per docs/prd.md's bucket table), so keying on
// STEP.id alone made checking a step on one profile's guide bleed into
// every other guide that happens to reuse that id — which is nearly all
// of them. Client-only, no backend.

import { useRef, useSyncExternalStore } from "react";

export type StepStatus = "done" | "not_done" | "not_applicable";

const STORAGE_KEY = "una:progress";

function storageKey(guideKey: string, stepId: string): string {
  return `${guideKey}::${stepId}`;
}

function readAll(): Record<string, StepStatus> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, StepStatus>) : {};
  } catch {
    return {};
  }
}

function writeStatus(guideKey: string, stepId: string, status: StepStatus): void {
  if (typeof window === "undefined") return;
  try {
    const all = readAll();
    all[storageKey(guideKey, stepId)] = status;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // localStorage may be unavailable (private mode, quota, disabled) —
    // the checkbox still works for this page view, it just won't persist.
  }
}

export function nextStatus(current: StepStatus): StepStatus {
  if (current === "not_done") return "done";
  if (current === "done") return "not_applicable";
  return "not_done";
}

// A localStorage read is an external-store read, not React state, so this
// uses useSyncExternalStore rather than an effect + setState — the latter
// would hydrate one render late and trip the "no setState in an effect
// body" lint rule for no real benefit.
type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getServerSnapshot(): StepStatus {
  return "not_done";
}

export function useStepStatus(guideKey: string, stepId: string): [StepStatus, (status: StepStatus) => void] {
  const key = storageKey(guideKey, stepId);
  const status = useSyncExternalStore(subscribe, () => readAll()[key] ?? "not_done", getServerSnapshot);

  function setStatus(next: StepStatus) {
    writeStatus(guideKey, stepId, next);
    listeners.forEach((listener) => listener());
  }

  return [status, setStatus];
}

/** Aggregate read for the "all steps done" guide-level state (SAA-41) —
 * needs every checkbox-bearing step's status in one place, not just one
 * step's. Returned keyed by bare stepId for caller convenience, even
 * though the underlying storage keys are guide-scoped. useSyncExternalStore
 * requires getSnapshot to return a stable reference when nothing changed,
 * so the snapshot is cached per hook instance (via useRef) and only
 * rebuilt when the underlying values actually differ. */
export function useAllStepStatuses(guideKey: string, stepIds: string[]): Record<string, StepStatus> {
  const cache = useRef<{ key: string; snapshot: Record<string, StepStatus> }>({ key: "", snapshot: {} });

  function getSnapshot(): Record<string, StepStatus> {
    const all = readAll();
    const key = stepIds.map((id) => `${id}:${all[storageKey(guideKey, id)] ?? "not_done"}`).join("|");
    if (key !== cache.current.key) {
      cache.current = {
        key,
        snapshot: Object.fromEntries(stepIds.map((id) => [id, all[storageKey(guideKey, id)] ?? "not_done"])),
      };
    }
    return cache.current.snapshot;
  }

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
