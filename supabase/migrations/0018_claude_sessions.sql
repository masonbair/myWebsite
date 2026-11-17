-- Claude Code sessions on Mason's laptop that Haiku judged worth his attention (lib/hub/sessions.ts).
-- A row exists only once a session was queued; later turns update it in place. The site's server writes, Mason reads.

create table public.claude_sessions (
  session_id text primary key check (session_id ~ '^[A-Za-z0-9-]{1,100}$'),
  project text not null check (char_length(project) between 1 and 80),
  branch text check (branch is null or char_length(branch) between 1 and 200),
  -- cleared: Mason replied to the session after it was queued, so it no longer waits on him.
  state text not null check (state in ('needs_you', 'done', 'cleared')),
  line text not null check (char_length(line) between 1 and 200),
  ended_at timestamptz,
  updated_at timestamptz not null default now()
);

create index claude_sessions_updated_idx on public.claude_sessions (updated_at desc);

alter table public.claude_sessions enable row level security;

create policy claude_sessions_owner_read on public.claude_sessions
  for select to authenticated using (public.is_owner());

revoke all on table public.claude_sessions from public, anon, authenticated, service_role;
grant select on table public.claude_sessions to authenticated, service_role;
grant insert, update on table public.claude_sessions to service_role;

-- Keeps every feature 0016_photo_labels.sql allowed.
alter table public.ai_usage drop constraint ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check check (feature in ('ideas', 'news', 'learn', 'photos', 'sessions'));
