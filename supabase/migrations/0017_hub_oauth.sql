-- Sign-ins that let claude.ai use the hub's MCP connector. Only hashes of codes and tokens are kept.
-- Setting revoked_at (or deleting the row) signs that connector out at once.

create table public.hub_oauth_grants (
  id uuid primary key,
  resource text not null,
  redirect_uri text not null,
  code_challenge text not null,
  code_hash text,
  code_expires_at timestamptz,
  access_hash text,
  access_expires_at timestamptz,
  refresh_hash text,
  refresh_expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hub_oauth_grants enable row level security;
revoke all on table public.hub_oauth_grants from public, anon, authenticated;
grant select, insert, update, delete on table public.hub_oauth_grants to service_role;
