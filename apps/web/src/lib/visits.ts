// Tracks the last content_version + timestamp seen for each published
// guide (keyed by cache_key), powering the PRD's guide-level "return
// visit" state (change banner) and the return_visit analytics event.

const VISITS_KEY = "una:visits";

interface VisitRecord {
  lastSeenAt: string; // ISO timestamp
  contentVersion: number;
}

function readAll(): Record<string, VisitRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(VISITS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, VisitRecord>) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, VisitRecord>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VISITS_KEY, JSON.stringify(all));
  } catch {
    // ignore — see profile.ts
  }
}

export interface ReturnVisitInfo {
  daysSinceLast: number;
  versionDelta: number;
}

/** Compares against the stored record for this guide (if any), then
 * overwrites it with the current visit. Returns null on a first-ever
 * visit to this specific guide — nothing to report yet. */
export function recordVisit(cacheKey: string, contentVersion: number): ReturnVisitInfo | null {
  const all = readAll();
  const previous = all[cacheKey];

  all[cacheKey] = { lastSeenAt: new Date().toISOString(), contentVersion };
  writeAll(all);

  if (!previous) return null;

  const daysSinceLast = Math.round((Date.now() - new Date(previous.lastSeenAt).getTime()) / (1000 * 60 * 60 * 24));
  return { daysSinceLast, versionDelta: contentVersion - previous.contentVersion };
}
