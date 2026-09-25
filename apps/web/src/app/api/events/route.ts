// The "our own endpoint keyed on the anonymous session id" the PRD's
// analytics section calls for (docs/prd.md, "No third-party analytics").
// Every event in EVENT_NAMES lands here, including feedback_submitted --
// its richer payload (scope, value, reason[], text, step_id, profile_hash,
// content_version, seconds_since_generation) just travels inside `payload`.

import { NextResponse } from "next/server";
import { isEventName } from "@/lib/events";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const { event, session_id: sessionId, payload } = body as Record<string, unknown>;

  if (typeof event !== "string" || !isEventName(event)) {
    return NextResponse.json({ error: "Unknown event" }, { status: 400 });
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }
  if (payload !== undefined && (typeof payload !== "object" || payload === null)) {
    return NextResponse.json({ error: "payload must be an object" }, { status: 400 });
  }

  try {
    const { error } = await supabaseServer()
      .from("events")
      .insert({
        event_name: event,
        session_id: sessionId,
        payload: (payload as Record<string, unknown> | undefined) ?? {},
      });

    if (error) {
      console.error("Failed to record event", error);
      return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
    }
  } catch (err) {
    console.error("Events route misconfigured", err);
    return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
