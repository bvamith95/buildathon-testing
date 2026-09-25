// The full event set from docs/prd.md's "Events to instrument" table.
// Shared between the client (what it's allowed to send) and the /api/events
// route (what it accepts), so the two can't drift.

export const EVENT_NAMES = [
  "landing_view",
  "level_selected",
  "intake_field_abandon",
  "guide_generated",
  "step_expanded",
  "step_checked",
  "outbound_click",
  "feedback_submitted",
  "reminder_opt_in",
  "share_initiated",
  "return_visit",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export function isEventName(value: string): value is EventName {
  return (EVENT_NAMES as readonly string[]).includes(value);
}
