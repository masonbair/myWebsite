-- What got done each day, one plain-words summary per project, written by Mason's agents from git history.
-- Rows are never deleted, and agents can only change the last few days, so the record of a day stays as it was.

create table public.timeline_entries (
  day date not null,
  project text not null check (char_length(project) between 1 and 80),
  summary text not null check (char_length(summary) between 1 and 4000),
  commits integer not null default 0 check (commits >= 0),
  branches text[] not null default '{}',
  public boolean not null default false,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (day, project)
);

-- Mirrors isOpenDay() in lib/hub/timeline.ts; the window is wide enough for any time zone's "today" and "yesterday".
create function public.timeline_guard_closed_days() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user = 'authenticated' and public.is_owner() then
    return new;
  end if;
  if new.day < current_date - 2 or new.day > current_date + 1
     or (tg_op = 'UPDATE' and (old.day <> new.day or old.day < current_date - 2)) then
    raise exception 'timeline day % is closed', new.day;
  end if;
  return new;
end;
$$;

create trigger timeline_guard_closed_days before insert or update on public.timeline_entries
  for each row execute function public.timeline_guard_closed_days();
create trigger timeline_entries_no_delete before delete on public.timeline_entries
  for each row execute function public.hub_no_delete();
create trigger timeline_entries_no_truncate before truncate on public.timeline_entries
  for each statement execute function public.hub_no_delete();

alter table public.timeline_entries enable row level security;

create policy timeline_entries_owner_read on public.timeline_entries
  for select to authenticated using (public.is_owner());

revoke all on table public.timeline_entries from public, anon, authenticated, service_role;
grant select on table public.timeline_entries to authenticated, service_role;
grant insert, update on table public.timeline_entries to service_role;
