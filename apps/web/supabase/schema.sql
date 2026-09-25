-- Una's event store: one flexible table covers every event in
-- docs/prd.md's "Events to instrument" table, including feedback_submitted
-- (its richer payload -- scope, value, reason[], text, step_id,
-- profile_hash, content_version, seconds_since_generation -- lives inside
-- `payload`, since a single JSONB column is simpler than a second table
-- at this scale and every event still shares the same session_id / name /
-- timestamp shape).
--
-- Run this once in the Supabase SQL Editor after creating the project.

create table if not exists events (
  id bigint generated always as identity primary key,
  event_name text not null,
  session_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_event_name_idx on events (event_name);
create index if not exists events_session_id_idx on events (session_id);
create index if not exists events_created_at_idx on events (created_at);

-- No anon/authenticated policies are created on purpose: this table is
-- only ever written to from the server-side /api/events route using the
-- service_role key, which bypasses RLS entirely. Enabling RLS with zero
-- policies means the anon key -- even if it leaked -- can neither read
-- nor write this table directly.
alter table events enable row level security;

-- Reminder opt-ins (SAA-45). Kept separate from `events` because it holds
-- real PII (email) rather than anonymous analytics, and because the
-- eventual send-side (SAA-24, still gated on the product owner's sending
-- domain) will read against it directly by bucket/level/arrival_date --
-- one opt-in row covers every future deadline in that guide, there's no
-- per-step selection here. `session_id` is deliberately NOT stored
-- alongside email: docs/prd.md's privacy line and the salted-profile_hash
-- design elsewhere both exist specifically so a session can't be tied to
-- a real identity, and storing them side by side here would undo that.
create table if not exists reminder_optins (
  id bigint generated always as identity primary key,
  email text not null,
  bucket_signature text not null,
  program_level text not null,
  arrival_date date not null,
  content_version integer not null,
  created_at timestamptz not null default now()
);

create index if not exists reminder_optins_email_idx on reminder_optins (email);

-- Same reasoning as `events` above: no anon/authenticated policies, so the
-- publishable key can neither read nor write this table -- only the
-- server-side /api/reminders route (service_role key) can.
alter table reminder_optins enable row level security;
