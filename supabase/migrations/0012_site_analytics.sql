-- Sole exception to append-only (reviewed 2026-11-09): analytics_record bumps hits on an existing daily row.

create table public.analytics_daily (
  day date not null,
  path text not null check (path = 'other' or (path ~ '^/[a-z0-9/._-]*$' and length(path) <= 64)),
  kind text not null check (kind in ('human', 'ai', 'search', 'bot')),
  agent text not null default '' check (length(agent) <= 40),
  ref_host text not null default '' check (ref_host = lower(ref_host) and length(ref_host) <= 100),
  from_assistant text not null default '' check (length(from_assistant) <= 40),
  country text not null default '' check (country ~ '^([A-Z]{2})?$'),
  ua_sample text not null default '' check (length(ua_sample) <= 120),
  hits integer not null default 0 check (hits >= 0),
  primary key (day, path, kind, agent, ref_host, from_assistant, country, ua_sample)
);

-- One row per human visitor per page per day; the hash's salt rotates daily, so days cannot be linked.
create table public.analytics_visitors (
  day date not null,
  path text not null check (path = 'other' or (path ~ '^/[a-z0-9/._-]*$' and length(path) <= 64)),
  visitor_hash text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  primary key (day, path, visitor_hash)
);

create trigger analytics_daily_no_delete before delete on public.analytics_daily
  for each row execute function public.hub_no_delete();
create trigger analytics_visitors_no_delete before delete on public.analytics_visitors
  for each row execute function public.hub_no_delete();
create trigger analytics_visitors_no_update before update on public.analytics_visitors
  for each row execute function public.hub_no_delete();

-- Caps stop a flood of random user agents or referrers from filling the free tier.
create function public.analytics_record(
  p_path text,
  p_kind text,
  p_agent text default '',
  p_ref_host text default '',
  p_from_assistant text default '',
  p_country text default '',
  p_ua_sample text default '',
  p_visitor_hash text default null
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/New_York')::date;
  v_path text := coalesce(p_path, 'other');
  v_agent text := left(coalesce(p_agent, ''), 40);
  v_ref text := left(lower(coalesce(p_ref_host, '')), 100);
  v_assistant text := left(coalesce(p_from_assistant, ''), 40);
  v_country text := upper(coalesce(p_country, ''));
  v_ua text := case when p_kind = 'bot' and v_agent = 'unknown' then left(coalesce(p_ua_sample, ''), 120) else '' end;
begin
  if v_path <> 'other' and (v_path !~ '^/[a-z0-9/._-]*$' or length(v_path) > 64) then
    v_path := 'other';
  end if;
  if v_country !~ '^[A-Z]{2}$' then
    v_country := '';
  end if;
  if v_ref !~ '^[a-z0-9.-]*$' then
    v_ref := 'invalid';
  end if;

  if not exists (
    select 1 from public.analytics_daily
    where day = today and path = v_path and kind = p_kind and agent = v_agent and ref_host = v_ref
      and from_assistant = v_assistant and country = v_country and ua_sample = v_ua
  ) and (select count(*) from public.analytics_daily where day = today) >= 5000 then
    v_path := 'other'; v_agent := 'overflow'; v_ref := ''; v_assistant := ''; v_country := ''; v_ua := '';
  end if;

  insert into public.analytics_daily as d (day, path, kind, agent, ref_host, from_assistant, country, ua_sample, hits)
  values (today, v_path, p_kind, v_agent, v_ref, v_assistant, v_country, v_ua, 1)
  on conflict (day, path, kind, agent, ref_host, from_assistant, country, ua_sample)
  do update set hits = d.hits + 1;

  if p_kind = 'human' and p_visitor_hash is not null
     and (select count(*) from public.analytics_visitors where day = today) < 20000 then
    insert into public.analytics_visitors (day, path, visitor_hash)
    values (today, v_path, p_visitor_hash)
    on conflict do nothing;
  end if;
end;
$$;

revoke execute on function public.analytics_record(text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.analytics_record(text, text, text, text, text, text, text, text) to service_role;

alter table public.analytics_daily enable row level security;
alter table public.analytics_visitors enable row level security;

create policy analytics_daily_owner_read on public.analytics_daily
  for select to authenticated using (public.is_owner());
create policy analytics_visitors_owner_read on public.analytics_visitors
  for select to authenticated using (public.is_owner());

revoke all on table public.analytics_daily, public.analytics_visitors from anon, authenticated, service_role;
grant select on table public.analytics_daily, public.analytics_visitors to authenticated;
