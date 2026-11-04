-- Private hub: only Mason (the row in hub_owner) reads or writes items and comments.
-- Guards live in triggers because the service role bypasses RLS but not triggers.

create table public.hub_owner (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  labels text[] not null default '{}',
  list text not null default 'inbox' check (list in ('inbox', 'todo', 'ideas')),
  state text not null default 'open' check (state in ('open', 'done', 'archived')),
  due_date date,
  due_time time,
  archived_reason text check (archived_reason in ('merged', 'memo-split')),
  merged_into uuid references public.items (id),
  source text not null,
  client_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index items_state_list_idx on public.items (state, list);
create index items_labels_idx on public.items using gin (labels);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id),
  body text not null,
  author text not null check (author in ('mason', 'worker', 'agent')),
  created_at timestamptz not null default now()
);

create index comments_item_id_idx on public.comments (item_id, created_at);

create table public.hub_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.memo_files (
  file text primary key,
  recorded timestamp,
  device text,
  item_id uuid references public.items (id),
  accepted_at timestamptz
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  item_id uuid references public.items (id),
  detail jsonb not null default '{}',
  at timestamptz not null default now()
);

-- Security definer so RLS policies can read hub_owner, which authenticated has no grant on.
create function public.is_owner() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.hub_owner where user_id = auth.uid());
$$;

revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated, service_role;

create function public.hub_no_delete() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'rows in % are never deleted', tg_table_name;
end;
$$;

create function public.items_guard_state() returns trigger
language plpgsql set search_path = ''
as $$
declare
  previous_state text := case when tg_op = 'UPDATE' then old.state else 'open' end;
  -- Any role can set request.jwt.claims on itself, so auth.uid() alone is only trusted for the authenticated role.
  caller_is_owner boolean := current_user = 'authenticated' and public.is_owner();
  previous_labels text[] := case when tg_op = 'UPDATE' then old.labels else '{}' end;
  had_claude boolean := 'claude' = any(previous_labels);
  has_claude boolean := 'claude' = any(new.labels);
begin
  if has_claude and not had_claude and not caller_is_owner then
    raise exception 'only the owner can approve an item for claude';
  end if;
  -- The worker drops claude only when it finishes or blocks (todo-hub lifecycle.ts finishLabels/blockLabels).
  if had_claude and not has_claude and not caller_is_owner
     and not new.labels && array['claude-done', 'claude-question'] then
    raise exception 'only the owner can remove the claude label';
  end if;
  if new.state = 'done' and previous_state <> 'done' and not caller_is_owner then
    raise exception 'only the owner can complete an item';
  end if;
  if previous_state = 'done' and new.state <> 'done' and not caller_is_owner then
    raise exception 'only the owner can move an item out of done';
  end if;
  if new.state = 'archived' then
    if new.archived_reason is null then
      raise exception 'archiving an item needs an archived_reason';
    end if;
    if new.archived_reason = 'merged' and new.merged_into is null then
      raise exception 'a merged item needs merged_into';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  if new.state = 'done' and previous_state <> 'done' then
    new.completed_at := now();
  elsif new.state = 'open' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger items_no_delete before delete on public.items
  for each row execute function public.hub_no_delete();
create trigger items_guard_state before insert or update on public.items
  for each row execute function public.items_guard_state();
create trigger comments_no_delete before delete on public.comments
  for each row execute function public.hub_no_delete();
create trigger hub_owner_no_delete before delete on public.hub_owner
  for each row execute function public.hub_no_delete();
create trigger hub_state_no_delete before delete on public.hub_state
  for each row execute function public.hub_no_delete();
create trigger memo_files_no_delete before delete on public.memo_files
  for each row execute function public.hub_no_delete();
create trigger audit_log_no_delete before delete on public.audit_log
  for each row execute function public.hub_no_delete();

-- Statement-level guard too, since a row trigger never fires on truncate.
create trigger items_no_truncate before truncate on public.items
  for each statement execute function public.hub_no_delete();
create trigger comments_no_truncate before truncate on public.comments
  for each statement execute function public.hub_no_delete();
create trigger hub_owner_no_truncate before truncate on public.hub_owner
  for each statement execute function public.hub_no_delete();
create trigger hub_state_no_truncate before truncate on public.hub_state
  for each statement execute function public.hub_no_delete();
create trigger memo_files_no_truncate before truncate on public.memo_files
  for each statement execute function public.hub_no_delete();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.hub_no_delete();

create function public.comments_guard_author() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.author = 'mason' and not (current_user = 'authenticated' and public.is_owner()) then
    raise exception 'only the signed-in owner can write as mason';
  end if;
  return new;
end;
$$;

create trigger comments_guard_author before insert or update of author on public.comments
  for each row execute function public.comments_guard_author();

create function public.hub_claim(p_item uuid, p_stale interval default '2 hours') returns boolean
language sql set search_path = ''
as $$
  with claimed as (
    update public.items
    set labels = array_remove(array_remove(array_remove(labels, 'claude-done'), 'claude-question'), 'claude-working')
                 || array['claude-working']
    where id = p_item
      and state = 'open'
      and labels @> '{claude}'
      and (not labels @> '{claude-working}' or updated_at < now() - p_stale)
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke execute on function public.hub_claim(uuid, interval) from public, anon, authenticated;
grant execute on function public.hub_claim(uuid, interval) to service_role;

alter table public.hub_owner enable row level security;
alter table public.items enable row level security;
alter table public.comments enable row level security;
alter table public.hub_state enable row level security;
alter table public.memo_files enable row level security;
alter table public.audit_log enable row level security;

create policy items_owner_only on public.items
  for all using (public.is_owner()) with check (public.is_owner());
create policy comments_owner_only on public.comments
  for all using (public.is_owner()) with check (public.is_owner());

revoke all on table public.hub_owner, public.items, public.comments,
  public.hub_state, public.memo_files, public.audit_log from anon, authenticated;
grant select, insert, update on table public.items, public.comments to authenticated;
