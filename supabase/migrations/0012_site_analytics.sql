-- Two reviewed exceptions to the hub guards (2026-11-09): analytics_record bumps hits on an existing daily row, and
-- analytics_roll_visitors deletes visitor hashes from past days, since a hash of salt+date+IP+UA is personal data.

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

-- Today's visitor hashes only; past days are counted into analytics_uniques and then removed.
create table public.analytics_visitors (
  day date not null,
  path text not null check (path = 'other' or (path ~ '^/[a-z0-9/._-]*$' and length(path) <= 64)),
  visitor_hash text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  primary key (day, path, visitor_hash)
);

-- path '*' is distinct visitors across the whole site that day.
create table public.analytics_uniques (
  day date not null,
  path text not null check (path in ('*', 'other') or (path ~ '^/[a-z0-9/._-]*$' and length(path) <= 64)),
  visitors integer not null check (visitors >= 0),
  primary key (day, path)
);

-- Lets only analytics_roll_visitors remove hashes, and only from past days.
create function public.analytics_visitors_guard_delete() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('analytics.rolling', true), '') <> 'on'
     or old.day >= (now() at time zone 'America/New_York')::date then
    raise exception 'rows in % are only removed by analytics_roll_visitors, and only for past days', tg_table_name;
  end if;
  return old;
end;
$$;

create trigger analytics_daily_no_delete before delete on public.analytics_daily
  for each row execute function public.hub_no_delete();
create trigger analytics_visitors_guard_delete before delete on public.analytics_visitors
  for each row execute function public.analytics_visitors_guard_delete();
create trigger analytics_uniques_no_delete before delete on public.analytics_uniques
  for each row execute function public.hub_no_delete();
create trigger analytics_uniques_no_update before update on public.analytics_uniques
  for each row execute function public.hub_no_delete();

create function public.analytics_roll_visitors() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/New_York')::date;
begin
  insert into public.analytics_uniques (day, path, visitors)
  select day, path, count(*) from public.analytics_visitors where day < today group by day, path
  union all
  select day, '*', count(distinct visitor_hash) from public.analytics_visitors where day < today group by day
  on conflict do nothing;
  perform set_config('analytics.rolling', 'on', true);
  delete from public.analytics_visitors where day < today;
  perform set_config('analytics.rolling', '', true);
end;
$$;

revoke execute on function public.analytics_roll_visitors() from public, anon, authenticated;
grant execute on function public.analytics_roll_visitors() to service_role;

-- 00:10 Eastern (05:10 UTC; 04:10 in summer is still after midnight Eastern).
select cron.schedule('analytics-roll-visitors', '10 5 * * *', $$ select public.analytics_roll_visitors() $$);
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
  if exists (select 1 from public.analytics_visitors where day < today) then
    perform public.analytics_roll_visitors();
  end if;
  if v_path <> 'other' and (v_path !~ '^/[a-z0-9/._-]*$' or length(v_path) > 64) then
    v_path := 'other';
  end if;
  if v_country !~ '^[A-Z]{2}$' then
    v_country := '';
  end if;
  if v_ref !~ '^[a-z0-9.-]*$' then
    v_ref := 'invalid';
  end if;
  if v_ua <> '' and (select count(*) from public.analytics_daily where day = today and ua_sample <> '') >= 200
     and not exists (select 1 from public.analytics_daily where day = today and ua_sample = v_ua) then
    v_ua := '';
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
alter table public.analytics_uniques enable row level security;

create policy analytics_daily_owner_read on public.analytics_daily
  for select to authenticated using (public.is_owner());
create policy analytics_visitors_owner_read on public.analytics_visitors
  for select to authenticated using (public.is_owner());
create policy analytics_uniques_owner_read on public.analytics_uniques
  for select to authenticated using (public.is_owner());

revoke all on table public.analytics_daily, public.analytics_visitors, public.analytics_uniques
  from anon, authenticated, service_role;
grant select on table public.analytics_daily, public.analytics_visitors, public.analytics_uniques to authenticated;

-- Runs as the caller, so RLS limits it to the owner; aggregates in SQL so the page never pages through raw rollups.
create function public.analytics_report(p_days integer default 28) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with bounds as (
    select (now() at time zone 'America/New_York')::date as today,
           (now() at time zone 'America/New_York')::date - (least(greatest(p_days, 7), 366) - 1) as since
  ),
  d as (select a.* from public.analytics_daily a, bounds b where a.day >= b.since),
  v as (select a.* from public.analytics_visitors a, bounds b where a.day = b.today),
  week as (select * from d, bounds b where d.day > b.today - 7),
  u as (
    select a.day, a.path, a.visitors from public.analytics_uniques a, bounds b where a.day >= b.since
    union all
    select day, path, count(*) from v group by day, path
    union all
    select day, '*', count(distinct visitor_hash) from v group by day
  ),
  week_u as (select u.* from u, bounds b where u.day > b.today - 7)
  select jsonb_build_object(
    'today', (select today from bounds),
    'since', (select since from bounds),
    'week', jsonb_build_object(
      'visitors', (select coalesce(sum(visitors), 0) from week_u where path = '*'),
      'views', (select coalesce(sum(hits), 0) from week where kind = 'human'),
      'coffee', (select coalesce(sum(hits), 0) from week where kind = 'human' and path = '/coffee'),
      'aiReads', (select coalesce(sum(hits), 0) from week where kind = 'ai'),
      'fromAssistants', (select coalesce(sum(hits), 0) from week where kind = 'human' and from_assistant <> '')
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', g.day, 'visitors', coalesce(vis.n, 0),
        'views', coalesce(agg.views, 0), 'aiReads', coalesce(agg.ai, 0)) order by g.day), '[]')
      from bounds b
      cross join lateral (select ts::date as day from generate_series(b.since, b.today, interval '1 day') ts) g
      left join (select day, visitors as n from u where path = '*') vis on vis.day = g.day
      left join (select day, sum(hits) filter (where kind = 'human') as views, sum(hits) filter (where kind = 'ai') as ai
                 from d group by day) agg on agg.day = g.day
    ),
    'pages', (
      select coalesce(jsonb_agg(p order by p.views desc), '[]') from (
        select w.path, sum(w.hits) filter (where w.kind = 'human') as views,
               sum(w.hits) filter (where w.kind <> 'human') as "botReads",
               (select coalesce(sum(wu.visitors), 0) from week_u wu where wu.path = w.path) as visitors
        from week w group by w.path
      ) p
    ),
    'coffeeSources', (
      select coalesce(jsonb_agg(c order by c.day desc, c.hits desc), '[]') from (
        select day, ref_host as "refHost", from_assistant as "fromAssistant", country, sum(hits) as hits
        from d where path = '/coffee' and kind = 'human'
        group by day, ref_host, from_assistant, country
        order by day desc, sum(hits) desc limit 100
      ) c
    ),
    'agents', (
      select coalesce(jsonb_agg(a order by a.hits desc), '[]') from (
        select agent, kind, sum(hits) as hits, max(day) as "lastSeen",
               jsonb_object_agg_strict(path, hits) as "byPath"
        from (select agent, kind, path, sum(hits) as hits, max(day) as day from d
              where kind in ('ai', 'search') group by agent, kind, path) per_path
        group by agent, kind
      ) a
    ),
    'assistants', (
      select coalesce(jsonb_agg(s order by s.hits desc), '[]') from (
        select from_assistant as name, sum(hits) as hits from d
        where kind = 'human' and from_assistant <> '' group by from_assistant
      ) s
    ),
    'referrers', (
      select coalesce(jsonb_agg(r order by r.hits desc), '[]') from (
        select ref_host as host, sum(hits) as hits from d
        where kind = 'human' and ref_host <> '' group by ref_host order by sum(hits) desc limit 15
      ) r
    ),
    'unknownBots', (
      select coalesce(jsonb_agg(u order by u.hits desc), '[]') from (
        select ua_sample as "userAgent", sum(hits) as hits from d
        where agent in ('unknown', 'overflow') group by ua_sample order by sum(hits) desc limit 10
      ) u
    )
  );
$$;

revoke execute on function public.analytics_report(integer) from public, anon;
grant execute on function public.analytics_report(integer) to authenticated;
