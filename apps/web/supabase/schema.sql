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
