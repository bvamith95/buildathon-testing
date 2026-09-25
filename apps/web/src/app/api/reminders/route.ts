// Reminder opt-in capture (SAA-45). Actual sending is a separate,
// still-gated track (SAA-24, the product owner's sending domain +
// unsubscribe mechanism) -- this route only records the opt-in so that
// work isn't blocked on it, per docs/implementation-plan.md ("build the
// UI regardless ... cut send-side only, not the opt-in capture").

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const { email, bucket_signature: bucketSignature, program_level: programLevel, arrival_date: arrivalDate, content_version: contentVersion } =
    body as Record<string, unknown>;

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  if (typeof bucketSignature !== "string" || bucketSignature.length === 0) {
    return NextResponse.json({ error: "bucket_signature is required" }, { status: 400 });
  }
  if (typeof programLevel !== "string" || programLevel.length === 0) {
    return NextResponse.json({ error: "program_level is required" }, { status: 400 });
  }
  if (typeof arrivalDate !== "string" || Number.isNaN(new Date(arrivalDate).getTime())) {
    return NextResponse.json({ error: "A valid arrival_date is required" }, { status: 400 });
  }
  if (typeof contentVersion !== "number") {
    return NextResponse.json({ error: "content_version is required" }, { status: 400 });
  }

  try {
    const { error } = await supabaseServer().from("reminder_optins").insert({
      email,
      bucket_signature: bucketSignature,
      program_level: programLevel,
      arrival_date: arrivalDate,
      content_version: contentVersion,
    });

    if (error) {
      console.error("Failed to record reminder opt-in", error);
      return NextResponse.json({ error: "Failed to record opt-in" }, { status: 500 });
    }
  } catch (err) {
    console.error("Reminders route misconfigured", err);
    return NextResponse.json({ error: "Failed to record opt-in" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
