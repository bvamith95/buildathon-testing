// Tracks whether this browser has already opted in to email reminders for
// a given guide profile, so the opt-in card doesn't reappear on repeat
// visits. Client-only -- the actual opt-in record lives server-side once
// submitted (see /api/reminders); this is just local UI memory.

const REMINDER_OPT_IN_KEY = "una:reminder_optin";

function readAll(): Record<string, true> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(REMINDER_OPT_IN_KEY);
    return raw ? (JSON.parse(raw) as Record<string, true>) : {};
  } catch {
    return {};
  }
}

export function hasOptedIn(profileKey: string): boolean {
  return Boolean(readAll()[profileKey]);
}

export function markOptedIn(profileKey: string): void {
  if (typeof window === "undefined") return;
  try {
    const all = readAll();
    all[profileKey] = true;
    window.localStorage.setItem(REMINDER_OPT_IN_KEY, JSON.stringify(all));
  } catch {
    // localStorage may be unavailable (private mode, quota, disabled) --
    // the opt-in still went through server-side, it just may re-prompt.
  }
}
