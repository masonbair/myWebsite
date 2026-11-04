-- Cat game shared leaderboard. Only the server route (service role key) reads and writes.
create table public.leaderboard (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 20),
  score int not null check (score between 1 and 1000),
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index leaderboard_score_idx on public.leaderboard (score desc);
create index leaderboard_ip_hash_created_at_idx on public.leaderboard (ip_hash, created_at);

-- RLS on with no policies: anon and authenticated roles get nothing; the service role bypasses RLS.
alter table public.leaderboard enable row level security;
revoke all on table public.leaderboard from anon, authenticated;
