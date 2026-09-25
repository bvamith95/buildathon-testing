#!/usr/bin/env node
// SAA-51: generates the Week 4 metrics report from docs/prd.md's "Success
// metrics" table against the live Supabase events store. Run with
// `npm run metrics` (optionally `-- --since=2026-10-01`) from apps/web.
//
// This is a report generator, not a dashboard: there's no UI, no auth
// surface to build or forget to lock down, and it can run against
// whatever slice of real usage exists (the full history, or --since a
// date, e.g. to isolate the SAA-58 dry run).

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const since = sinceArg ? sinceArg.slice("--since=".length) : null;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (apps/web/.env.local).");
  process.exit(1);
}
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

// PostgREST caps a single response at 1000 rows by default -- page through
// with .range() so a report run after real usage has grown doesn't quietly
// truncate.
async function fetchAll(table, dateColumn = "created_at") {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    let query = supabase
      .from(table)
      .select("*")
      .order(dateColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    if (since) query = query.gte(dateColumn, since);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const idx = Math.min(sortedValues.length - 1, Math.ceil(p * sortedValues.length) - 1);
  return sortedValues[Math.max(0, idx)];
}

function pct(n, d) {
  if (!d) return "n/a (denominator is 0)";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key === undefined || key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

(async () => {
  const [events, reminderOptins] = await Promise.all([fetchAll("events"), fetchAll("reminder_optins")]);

  const byName = (name) => events.filter((e) => e.event_name === name);
  const uniqueSessions = (rows) => new Set(rows.map((r) => r.session_id));

  const levelSelected = byName("level_selected");
  const guideGenerated = byName("guide_generated");
  const guideGeneratedSessions = uniqueSessions(guideGenerated);
  const feedback = byName("feedback_submitted");
  const overall = feedback.filter((e) => e.payload?.scope === "overall");
  const step = feedback.filter((e) => e.payload?.scope === "step");
  const stepChecked = byName("step_checked");
  const outboundClicks = byName("outbound_click");

  // --- Primary metrics (docs/prd.md "Success metrics") ---

  // Completion rate: guides generated / intakes started (the level tap,
  // not a landing view -- docs/decisions.md item 7).
  const completionRate = pct(guideGenerated.length, levelSelected.length);

  // Time to value, p95. latency_ms is measured from when the guide page's
  // fetch effect starts to guide_generated firing (apps/web/src/app/guide/
  // page.tsx) -- it does NOT include the intake-to-guide client-side
  // navigation itself. docs/testing-matrix.md measured that leg separately
  // at ~100ms baseline, so this under-counts the PRD's literal "form
  // submission to timeline on screen" by roughly that much.
  const latencies = guideGenerated
    .map((e) => e.payload?.latency_ms)
    .filter((v) => typeof v === "number")
    .sort((a, b) => a - b);
  const p95Latency = percentile(latencies, 0.95);

  // Helpful rate: overall thumbs-up / guides generated, EXCLUDING sessions
  // that rated individual steps but never rated overall from the
  // denominator (docs/decisions.md item 7) -- tracked separately below,
  // not folded in as a neutral/negative. Computed per-session (not per
  // guide-generation event) since the exclusion criterion is inherently
  // about a person's behavior across their session, not a single event;
  // this slightly understates the denominator if one session generates
  // more than one guide, which isn't expected to be common.
  const sessionsWithStepFeedback = uniqueSessions(step);
  const sessionsWithOverallFeedback = uniqueSessions(overall);
  const stepOnlyNoOverallSessions = [...sessionsWithStepFeedback].filter(
    (s) => !sessionsWithOverallFeedback.has(s) && guideGeneratedSessions.has(s)
  );
  const helpfulRateDenominator = guideGeneratedSessions.size - stepOnlyNoOverallSessions.length;
  const overallUpSessions = uniqueSessions(overall.filter((e) => e.payload?.value === "up"));
  const overallDownSessions = uniqueSessions(overall.filter((e) => e.payload?.value === "down"));
  const helpfulRate = pct(overallUpSessions.size, helpfulRateDenominator);

  // --- Supporting signals (no target, per docs/prd.md) ---

  const perStepThumbs = new Map();
  for (const e of step) {
    const stepId = e.payload?.step_id ?? "(unknown)";
    const value = e.payload?.value;
    if (!perStepThumbs.has(stepId)) perStepThumbs.set(stepId, { up: 0, down: 0 });
    if (value === "up") perStepThumbs.get(stepId).up++;
    if (value === "down") perStepThumbs.get(stepId).down++;
  }

  const reasonCounts = new Map();
  for (const e of feedback) {
    const reasons = Array.isArray(e.payload?.reason) ? e.payload.reason : [];
    for (const r of reasons) reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
  }

  const outboundByHost = countBy(outboundClicks, (e) => e.payload?.host);

  const reminderOptInRate = pct(reminderOptins.length, guideGenerated.length);

  // Step completion depth: dedupe to each session's LAST recorded status
  // per step_id (a step can be cycled through states more than once), then
  // report how many steps land "resolved" (done or not_applicable) per
  // session. This is a proxy, not an exact completion percentage -- it has
  // no way to know the guide's total step count from the event log alone.
  const lastStatusBySessionStep = new Map();
  for (const e of stepChecked) {
    const key = `${e.session_id}::${e.payload?.step_id}`;
    lastStatusBySessionStep.set(key, e.payload?.status); // later events overwrite earlier ones (fetched in ascending order)
  }
  const resolvedCountBySession = new Map();
  for (const [key, status] of lastStatusBySessionStep) {
    const sessionId = key.split("::")[0];
    if (status === "done" || status === "not_applicable") {
      resolvedCountBySession.set(sessionId, (resolvedCountBySession.get(sessionId) ?? 0) + 1);
    }
  }
  const resolvedCounts = [...resolvedCountBySession.values()];
  const avgResolvedPerSession = resolvedCounts.length
    ? (resolvedCounts.reduce((a, b) => a + b, 0) / resolvedCounts.length).toFixed(1)
    : "n/a";

  // --- Print ---

  const rangeLabel = since ? `since ${since}` : "all-time";
  console.log(`\nUna metrics report -- ${rangeLabel} (generated ${new Date().toISOString()})\n`);

  console.log("PRIMARY METRICS (docs/prd.md targets)");
  console.log(`  Completion rate   ${completionRate}  (target 70%)   [${guideGenerated.length} guides / ${levelSelected.length} level taps]`);
  console.log(
    `  Helpful rate      ${helpfulRate}  (target 60%)   [${overallUpSessions.size} up / ${helpfulRateDenominator} sessions; excludes ${stepOnlyNoOverallSessions.length} step-only-no-overall sessions, tracked below]`
  );
  console.log(
    `  Time to value p95 ${p95Latency !== null ? `${p95Latency}ms` : "n/a — no guide_generated events with latency_ms yet"}  (target <15000ms, expected <2000ms)  [n=${latencies.length}]`
  );
  if (latencies.length > 0 && latencies.length < 20) {
    console.log(`    caution: n=${latencies.length} is too small for a stable p95 -- treat as directional only`);
  }
  console.log(
    "    note: latency_ms excludes the intake->guide client-side navigation itself (~100ms baseline, see docs/testing-matrix.md)"
  );

  console.log("\nSUPPORTING SIGNALS (no target)");
  console.log(`  Overall ratings: ${overallUpSessions.size} up / ${overallDownSessions.size} down (unique sessions)`);
  console.log(`  Step-only-no-overall sessions (rated steps, never rated overall): ${stepOnlyNoOverallSessions.length}`);
  console.log(`  Reminder opt-in rate: ${reminderOptInRate}  [${reminderOptins.length} opt-ins / ${guideGenerated.length} guides generated]`);
  console.log(`  Return visits: ${byName("return_visit").length}`);
  console.log(`  Share initiated: ${byName("share_initiated").length}`);
  console.log(`  Avg steps resolved (done/not_applicable) per session that touched a checkbox: ${avgResolvedPerSession} [n=${resolvedCounts.length} sessions]`);

  console.log("\n  Per-step thumbs (up/down):");
  if (perStepThumbs.size === 0) console.log("    (none yet)");
  for (const [stepId, { up, down }] of [...perStepThumbs.entries()].sort((a, b) => b[1].down - a[1].down)) {
    console.log(`    ${stepId}: ${up} up / ${down} down`);
  }

  console.log("\n  Thumbs-down reason chips:");
  if (reasonCounts.size === 0) console.log("    (none yet)");
  for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${reason}: ${count}`);
  }

  console.log("\n  Outbound clicks by host:");
  if (outboundByHost.length === 0) console.log("    (none yet)");
  for (const [host, count] of outboundByHost) {
    console.log(`    ${host}: ${count}`);
  }

  console.log(
    "\nCaution (docs/prd.md): 12 of 21 survey respondents asked to trial the tool and 9 left an email -- if this range includes that warm panel, treat the first helpful rate as a ceiling, not a baseline. Use --since to isolate a later, colder cohort once one exists.\n"
  );
})();
