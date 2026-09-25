// Client profile persistence for the "URL params -> localStorage -> fresh
// start" resolution order (CLAUDE.md's architectural constraint). Stores
// the raw URL query values rather than a parsed shape, since restoring is
// then just re-building the same querystring the URL parsing already
// understands, with nothing new to keep in sync.

const PROFILE_KEY = "una:profile";

export interface StoredProfile {
  c: string;
  d: string;
  l: string;
  e?: string;
}

export function saveProfile(profile: StoredProfile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // localStorage may be unavailable (private mode, quota, disabled) —
    // the current visit still works, it just won't be restorable later.
  }
}

export function loadProfile(): StoredProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as StoredProfile) : null;
  } catch {
    return null;
  }
}
