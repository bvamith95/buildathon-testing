// Client-side half of the events pipe: an anonymous session id and a
// fire-and-forget track() that posts to /api/events. Analytics must never
// break or block the product, so failures are swallowed silently.
//
// Actual track() calls from Landing/Intake/Guide are separate follow-on
// work (SAA-32/34/46/50) -- this is the scaffold (SAA-67) those wire into.

import { EventName } from "./events";

const SESSION_ID_KEY = "una:session_id";

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(SESSION_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export function track(event: EventName, payload: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const sessionId = getSessionId();
  if (!sessionId) return; // localStorage unavailable — skip rather than break the UX

  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, session_id: sessionId, payload }),
    keepalive: true,
  }).catch(() => {
    // Analytics is best-effort; a dropped event is never worth surfacing.
  });
}

/** Salted per session_id so the same profile can't be matched across
 * sessions or against the plain profile parameters in a shared URL
 * (docs/decisions.md item 6). `profile` should be a stable string built
 * from the profile's own fields, e.g. `${bucketSignature}|${level}`. */
export async function computeProfileHash(profile: string, sessionId: string): Promise<string> {
  const data = new TextEncoder().encode(`${sessionId}:${profile}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
