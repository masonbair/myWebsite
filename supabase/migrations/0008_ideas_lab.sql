-- Ideas Lab: reviews, detection, calendar returns and Claude spend for ideas, which stay ordinary hub items.
-- Same rules as the hub: owner-only reads, no deletes, and guards in triggers because the service role skips RLS.

create table public.ai_usage (
  id bigint generated always as identity primary key,
  feature text not null check (feature in ('ideas', 'news')),
  model text not null,
  input_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  output_tokens int not null default 0,
  web_searches int not null default 0,
  cost_usd numeric(10, 6) not null,
  item_id uuid references public.items (id),
  purpose text not null,
  at timestamptz not null default now()
);

create index ai_usage_feature_at_idx on public.ai_usage (feature, at);

create table public.idea_settings (
  item_id uuid primary key references public.items (id),
  enrolled boolean not null default false,
  schedule_from date,
  reminders_stopped_at timestamptz,
  no_web_search boolean not null default false,
  review_status text not null default 'none'
    check (review_status in ('none', 'waiting', 'working', 'done', 'failed', 'paused')),
  review_requested_at timestamptz,
  review_note text check (length(review_note) <= 2000),
  review_attempts int not null default 0,
  review_claimed_at timestamptz,
  last_error text,
  moved_from_inbox boolean not null default false,
  mention_count int not null default 1,
  updated_at timestamptz not null default now()
);

create index idea_settings_review_idx on public.idea_settings (review_status, review_requested_at);

create table public.idea_reviews (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.items (id),
  version int not null,
  review jsonb not null,
  model text not null,
  prompt_version text not null,
  note text,
  cost_usd numeric(10, 6) not null,
  created_at timestamptz not null default now(),
  unique (item_id, version)
);

create table public.idea_sources (
  source_item_id uuid primary key references public.items (id),
  kind text not null check (kind in ('capture', 'memo')),
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  idea_item_ids uuid[] not null default '{}',
  quotes jsonb not null default '[]',
  attempts int not null default 0,
  model text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.idea_resurface (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.items (id),
  step int not null check (step in (1, 2, 3)),
  due_date date not null,
  event_date date,
  google_event_id text,
  status text not null default 'planned' check (status in ('planned', 'sent', 'closed', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, step, due_date)
);

create index idea_resurface_status_idx on public.idea_resurface (status, due_date);

create table public.idea_google (
  id boolean primary key default true check (id),
  connected boolean not null default false,
  calendar_id text,
  connected_at timestamptz,
  disconnected_at timestamptz,
  oauth_state text,
  oauth_state_at timestamptz
);

insert into public.idea_google default values;

-- HiNote transcripts the Mac sends read-only while its memos still go to todo-hub; detection reads them like sources.
create table public.idea_recordings (
  file text primary key check (file ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  recorded timestamp not null,
  transcript text not null check (length(transcript) <= 1000000),
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts int not null default 0,
  idea_item_ids uuid[] not null default '{}',
  quotes jsonb not null default '[]',
  model text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idea_recordings_status_idx on public.idea_recordings (status, created_at);

-- No role bypass: a resent or forged upload must never rewrite what Mason said or when.
create function public.idea_recordings_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.file is distinct from old.file or new.recorded is distinct from old.recorded
     or new.transcript is distinct from old.transcript then
    raise exception 'a recording''s file, time and transcript never change';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger idea_recordings_guard before update on public.idea_recordings
  for each row execute function public.idea_recordings_guard();

-- The owner may only ask for a review or set it back to none; the job's bookkeeping columns belong to the service role.
create function public.idea_settings_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  if current_user = 'service_role' then
    return new;
  end if;
  if (tg_op = 'INSERT' or new.review_status is distinct from old.review_status)
     and new.review_status not in ('none', 'waiting') then
    raise exception 'only the ideas job can set a review to %', new.review_status;
  end if;
  -- Leaving a live claim would let "Review again" start a second paid run while the first is still going.
  if tg_op = 'UPDATE' and old.review_status = 'working' and new.review_status is distinct from old.review_status
     and coalesce(old.review_claimed_at, '-infinity') >= now() - interval '30 minutes' then
    raise exception 'a review is running; try again in a few minutes';
  end if;
  if tg_op = 'INSERT' then
    if new.review_attempts <> 0 or new.review_claimed_at is not null or new.mention_count <> 1
       or new.moved_from_inbox or new.last_error is not null then
      raise exception 'only the ideas job sets review bookkeeping';
    end if;
  elsif new.review_attempts is distinct from old.review_attempts
        or new.review_claimed_at is distinct from old.review_claimed_at
        or new.mention_count is distinct from old.mention_count
        or new.moved_from_inbox is distinct from old.moved_from_inbox
        or new.last_error is distinct from old.last_error then
    raise exception 'only the ideas job changes review bookkeeping';
  end if;
  -- A retry starts fresh, or the first stale re-claim would fail it again on the old attempt count.
  if tg_op = 'UPDATE' and new.review_status = 'waiting' and old.review_status not in ('waiting', 'working') then
    new.review_attempts := 0;
    new.last_error := null;
  end if;
  return new;
end;
$$;

create trigger idea_settings_guard before insert or update on public.idea_settings
  for each row execute function public.idea_settings_guard();

create function public.ideas_touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger idea_sources_touch before update on public.idea_sources
  for each row execute function public.ideas_touch_updated_at();
create trigger idea_resurface_touch before update on public.idea_resurface
  for each row execute function public.ideas_touch_updated_at();

create trigger ai_usage_no_update before update on public.ai_usage
  for each row execute function public.now_no_update();
create trigger idea_reviews_no_update before update on public.idea_reviews
  for each row execute function public.now_no_update();

create trigger ai_usage_no_delete before delete on public.ai_usage
  for each row execute function public.hub_no_delete();
create trigger idea_settings_no_delete before delete on public.idea_settings
  for each row execute function public.hub_no_delete();
create trigger idea_reviews_no_delete before delete on public.idea_reviews
  for each row execute function public.hub_no_delete();
create trigger idea_sources_no_delete before delete on public.idea_sources
  for each row execute function public.hub_no_delete();
create trigger idea_resurface_no_delete before delete on public.idea_resurface
  for each row execute function public.hub_no_delete();
create trigger idea_google_no_delete before delete on public.idea_google
  for each row execute function public.hub_no_delete();
create trigger idea_recordings_no_delete before delete on public.idea_recordings
  for each row execute function public.hub_no_delete();

-- Statement-level guard too, since a row trigger never fires on truncate.
create trigger ai_usage_no_truncate before truncate on public.ai_usage
  for each statement execute function public.hub_no_delete();
create trigger idea_settings_no_truncate before truncate on public.idea_settings
  for each statement execute function public.hub_no_delete();
create trigger idea_reviews_no_truncate before truncate on public.idea_reviews
  for each statement execute function public.hub_no_delete();
create trigger idea_sources_no_truncate before truncate on public.idea_sources
  for each statement execute function public.hub_no_delete();
create trigger idea_resurface_no_truncate before truncate on public.idea_resurface
  for each statement execute function public.hub_no_delete();
create trigger idea_google_no_truncate before truncate on public.idea_google
  for each statement execute function public.hub_no_delete();
create trigger idea_recordings_no_truncate before truncate on public.idea_recordings
  for each statement execute function public.hub_no_delete();

-- Security definer so a capture saved by the owner can queue rows in tables the owner cannot write; errors roll the capture back.
create function public.items_ideas_intake() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.list = 'inbox' then
    insert into public.idea_sources (source_item_id, kind, status)
    values (new.id, 'capture', 'pending')
    on conflict do nothing;
  else
    insert into public.idea_settings (item_id, enrolled, schedule_from, review_status, review_requested_at)
    values (new.id, true, current_date, 'waiting', now())
    on conflict do nothing;
  end if;
  return null;
end;
$$;

revoke execute on function public.items_ideas_intake() from public, anon, authenticated, service_role;

-- Only phone and web captures; shares, imports and restores are never read on their own (spec section 2).
create trigger items_ideas_intake after insert on public.items
  for each row when (new.source = 'capture' and new.list in ('inbox', 'ideas'))
  execute function public.items_ideas_intake();

-- Skip locked so two overlapping job runs never claim the same idea.
-- A stale claim means a run died mid-review; it counts as an attempt, and a second one fails the idea so it never loops on paid calls.
create function public.ideas_claim_review(p_stale interval default '30 minutes') returns uuid
language plpgsql set search_path = ''
as $$
declare
  picked public.idea_settings;
begin
  loop
    select * into picked from public.idea_settings
    where review_status = 'waiting'
       or (review_status = 'working' and coalesce(review_claimed_at, '-infinity') < now() - p_stale)
    order by review_requested_at nulls last, item_id
    limit 1
    for update skip locked;
    if not found then
      return null;
    end if;
    if picked.review_status = 'waiting' then
      update public.idea_settings set review_status = 'working', review_claimed_at = now()
      where item_id = picked.item_id;
      return picked.item_id;
    end if;
    if picked.review_attempts + 1 >= 2 then
      update public.idea_settings
      set review_status = 'failed', last_error = 'stale', review_attempts = picked.review_attempts + 1
      where item_id = picked.item_id;
    else
      update public.idea_settings
      set review_claimed_at = now(), review_attempts = picked.review_attempts + 1
      where item_id = picked.item_id;
      return picked.item_id;
    end if;
  end loop;
end;
$$;

revoke execute on function public.ideas_claim_review(interval) from public, anon, authenticated;
grant execute on function public.ideas_claim_review(interval) to service_role;

-- The Google refresh token lives only in Vault; an empty string blanks it on disconnect.
create function public.ideas_google_token_set(p_token text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  secret_id uuid;
begin
  select id into secret_id from vault.secrets where name = 'ideas_google_refresh_token';
  if secret_id is null then
    perform vault.create_secret(coalesce(p_token, ''), 'ideas_google_refresh_token');
  else
    perform vault.update_secret(secret_id, coalesce(p_token, ''));
  end if;
end;
$$;

create function public.ideas_google_token_get() returns text
language sql stable security definer set search_path = ''
as $$
  select nullif(decrypted_secret, '') from vault.decrypted_secrets where name = 'ideas_google_refresh_token';
$$;

revoke execute on function public.ideas_google_token_set(text) from public, anon, authenticated;
revoke execute on function public.ideas_google_token_get() from public, anon, authenticated;
grant execute on function public.ideas_google_token_set(text) to service_role;
grant execute on function public.ideas_google_token_get() to service_role;

alter table public.ai_usage enable row level security;
alter table public.idea_settings enable row level security;
alter table public.idea_reviews enable row level security;
alter table public.idea_sources enable row level security;
alter table public.idea_resurface enable row level security;
alter table public.idea_google enable row level security;
alter table public.idea_recordings enable row level security;

create policy ai_usage_owner_read on public.ai_usage
  for select to authenticated using (public.is_owner());
create policy idea_settings_owner_read on public.idea_settings
  for select to authenticated using (public.is_owner());
create policy idea_settings_owner_insert on public.idea_settings
  for insert to authenticated with check (public.is_owner());
create policy idea_settings_owner_update on public.idea_settings
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy idea_reviews_owner_read on public.idea_reviews
  for select to authenticated using (public.is_owner());
create policy idea_sources_owner_read on public.idea_sources
  for select to authenticated using (public.is_owner());
create policy idea_resurface_owner_read on public.idea_resurface
  for select to authenticated using (public.is_owner());
create policy idea_recordings_owner_read on public.idea_recordings
  for select to authenticated using (public.is_owner());

revoke all on table public.ai_usage, public.idea_settings, public.idea_reviews,
  public.idea_sources, public.idea_resurface, public.idea_google, public.idea_recordings from public, anon, authenticated;
revoke all on sequence public.ai_usage_id_seq, public.idea_reviews_id_seq, public.idea_resurface_id_seq
  from public, anon, authenticated;
grant select on table public.ai_usage, public.idea_settings, public.idea_reviews,
  public.idea_sources, public.idea_resurface, public.idea_recordings to authenticated;
grant insert on table public.idea_settings to authenticated;
grant update (reminders_stopped_at, no_web_search, review_status, review_requested_at, review_note, enrolled, schedule_from)
  on table public.idea_settings to authenticated;

select cron.schedule('hub-ideas', '*/15 * * * *', $$ select public.hub_post_event('ideas') $$);
