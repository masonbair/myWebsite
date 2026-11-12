-- Mason's login reads every learn table and writes none, so only server code can make a grade or a Focus Lock grant.

create table public.learn_exercises (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  position smallint not null check (position between 1 and 4),
  type text not null check (type in ('scenario', 'explain', 'voice')),
  topic text not null check (topic in ('value', 'products', 'communication', 'explain-simply')),
  question text not null check (length(question) between 10 and 2000),
  client text check (length(client) <= 300),
  reading_title text not null check (length(reading_title) <= 300),
  reading_url text not null check (reading_url ~ '^https://' and length(reading_url) <= 2000),
  reading_summary text not null check (length(reading_summary) <= 600),
  reading_why text check (length(reading_why) <= 300),
  model text not null,
  created_at timestamptz not null default now(),
  unique (date, position)
);

create table public.learn_answers (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null unique references public.learn_exercises (id),
  kind text not null check (kind in ('typed', 'voice')),
  body text check (length(body) <= 8000),
  clip_path text check (clip_path ~ '^answers/[0-9a-f-]{36}\.(webm|m4a|ogg)$'),
  clip_mime text check (clip_mime in ('audio/webm', 'audio/mp4', 'audio/ogg')),
  clip_duration_ms int check (clip_duration_ms between 1000 and 300000),
  transcript text check (length(transcript) <= 20000),
  status text not null check (status in ('grading', 'awaiting_transcript', 'transcribed', 'graded', 'failed')),
  attempts int not null default 0,
  last_error text check (length(last_error) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'typed' or (body is not null and clip_path is null and clip_mime is null and clip_duration_ms is null)),
  check (kind <> 'voice' or (clip_path is not null and clip_mime is not null and clip_duration_ms is not null and body is null))
);

create index learn_answers_status_idx on public.learn_answers (status, updated_at);

create table public.learn_grades (
  answer_id uuid primary key references public.learn_answers (id),
  grade text not null check (grade in ('A', 'A-', 'B+', 'B', 'B-', 'C', 'D', 'F')),
  worked text not null check (length(worked) <= 1000),
  fix text not null check (length(fix) <= 1000),
  better text not null check (length(better) <= 4000),
  resources jsonb not null check (jsonb_typeof(resources) = 'array' and jsonb_array_length(resources) between 0 and 2),
  jargon_opening boolean,
  delivery text check (length(delivery) <= 1000),
  minutes smallint not null check (minutes between 0 and 10),
  late boolean not null default false,
  model text,
  created_at timestamptz not null default now()
);

create table public.learn_readings (
  exercise_id uuid primary key references public.learn_exercises (id),
  takeaway text not null check (length(takeaway) between 1 and 500),
  accepted boolean not null,
  feedback text not null check (length(feedback) <= 600),
  minutes smallint not null check (minutes between 0 and 1),
  created_at timestamptz not null default now()
);

create table public.learn_grants (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  package text not null check (package = 'com.instagram.android'),
  minutes smallint not null check (minutes between 1 and 60),
  nonce text not null unique check (nonce ~ '^[A-Za-z0-9_-]{22}$'),
  msg text not null,
  sig text not null check (sig ~ '^[A-Za-z0-9+/]{86}==$'),
  answer_id uuid unique references public.learn_answers (id),
  reading_exercise_id uuid unique references public.learn_exercises (id),
  created_at timestamptz not null default now(),
  check ((answer_id is null) <> (reading_exercise_id is null))
);

create index learn_grants_date_idx on public.learn_grants (date);

-- A trigger, not a check, because to_char is not immutable; the lock keeps two racing gradings under the daily cap.
create function public.learn_grants_before_insert() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.msg is distinct from
     'fl-grant-v1|' || to_char(new.date, 'YYYY-MM-DD') || '|' || new.package || '|' || new.minutes || '|' || new.nonce then
    raise exception 'learn grant msg does not match its columns' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtext('learn_grants:' || to_char(new.date, 'YYYY-MM-DD')));
  if (select coalesce(sum(minutes), 0) from public.learn_grants where date = new.date) + new.minutes > 10 then
    raise exception 'learn grants for % would pass the daily cap of 10 minutes', new.date;
  end if;
  return new;
end;
$$;

create trigger learn_grants_before_insert before insert on public.learn_grants
  for each row execute function public.learn_grants_before_insert();

-- What Mason sent never changes; a transcript is set once. Status and retry bookkeeping may move.
create function public.learn_answers_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.exercise_id is distinct from old.exercise_id or new.kind is distinct from old.kind
     or new.body is distinct from old.body or new.clip_path is distinct from old.clip_path
     or new.clip_mime is distinct from old.clip_mime or new.clip_duration_ms is distinct from old.clip_duration_ms
     or new.created_at is distinct from old.created_at then
    raise exception 'what was sent in learn_answers never changes';
  end if;
  if old.transcript is not null and new.transcript is distinct from old.transcript then
    raise exception 'a learn_answers transcript is set once';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger learn_answers_guard before update on public.learn_answers
  for each row execute function public.learn_answers_guard();

create trigger learn_exercises_no_update before update on public.learn_exercises
  for each row execute function public.now_no_update();
create trigger learn_grades_no_update before update on public.learn_grades
  for each row execute function public.now_no_update();
create trigger learn_readings_no_update before update on public.learn_readings
  for each row execute function public.now_no_update();
create trigger learn_grants_no_update before update on public.learn_grants
  for each row execute function public.now_no_update();

create trigger learn_exercises_no_delete before delete on public.learn_exercises
  for each row execute function public.hub_no_delete();
create trigger learn_answers_no_delete before delete on public.learn_answers
  for each row execute function public.hub_no_delete();
create trigger learn_grades_no_delete before delete on public.learn_grades
  for each row execute function public.hub_no_delete();
create trigger learn_readings_no_delete before delete on public.learn_readings
  for each row execute function public.hub_no_delete();
create trigger learn_grants_no_delete before delete on public.learn_grants
  for each row execute function public.hub_no_delete();
create trigger learn_exercises_no_truncate before truncate on public.learn_exercises
  for each statement execute function public.hub_no_delete();
create trigger learn_answers_no_truncate before truncate on public.learn_answers
  for each statement execute function public.hub_no_delete();
create trigger learn_grades_no_truncate before truncate on public.learn_grades
  for each statement execute function public.hub_no_delete();
create trigger learn_readings_no_truncate before truncate on public.learn_readings
  for each statement execute function public.hub_no_delete();
create trigger learn_grants_no_truncate before truncate on public.learn_grants
  for each statement execute function public.hub_no_delete();

-- The grade and its grant land together or not at all; a second save for the same answer writes nothing.
create function public.learn_save_grade(p_answer_id uuid, p_grade jsonb, p_grant jsonb) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.learn_answers where id = p_answer_id for update;
  if not found then
    raise exception 'no learn answer %', p_answer_id using errcode = 'P0002';
  end if;
  if exists (select 1 from public.learn_grades where answer_id = p_answer_id) then
    return 'duplicate';
  end if;

  insert into public.learn_grades (answer_id, grade, worked, fix, better, resources, jargon_opening, delivery, minutes, late, model)
  values (p_answer_id, p_grade->>'grade', p_grade->>'worked', p_grade->>'fix', p_grade->>'better',
          coalesce(p_grade->'resources', '[]'::jsonb), (p_grade->>'jargon_opening')::boolean, p_grade->>'delivery',
          (p_grade->>'minutes')::smallint, coalesce((p_grade->>'late')::boolean, false), p_grade->>'model');

  if p_grant is not null then
    insert into public.learn_grants (date, package, minutes, nonce, msg, sig, answer_id)
    values ((p_grant->>'date')::date, coalesce(p_grant->>'package', 'com.instagram.android'), (p_grant->>'minutes')::smallint,
            p_grant->>'nonce', p_grant->>'msg', p_grant->>'sig', p_answer_id);
  end if;

  update public.learn_answers set status = 'graded', last_error = null where id = p_answer_id;
  return 'ok';
end;
$$;

create function public.learn_save_takeaway(p_exercise_id uuid, p_takeaway text, p_accepted boolean, p_feedback text,
                                           p_minutes int, p_grant jsonb) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.learn_exercises where id = p_exercise_id for update;
  if not found then
    raise exception 'no learn exercise %', p_exercise_id using errcode = 'P0002';
  end if;
  if exists (select 1 from public.learn_readings where exercise_id = p_exercise_id) then
    return 'duplicate';
  end if;

  insert into public.learn_readings (exercise_id, takeaway, accepted, feedback, minutes)
  values (p_exercise_id, p_takeaway, p_accepted, p_feedback, p_minutes);

  if p_grant is not null then
    insert into public.learn_grants (date, package, minutes, nonce, msg, sig, reading_exercise_id)
    values ((p_grant->>'date')::date, coalesce(p_grant->>'package', 'com.instagram.android'), (p_grant->>'minutes')::smallint,
            p_grant->>'nonce', p_grant->>'msg', p_grant->>'sig', p_exercise_id);
  end if;
  return 'ok';
end;
$$;

create function public.learn_attach_transcript(p_id uuid, p_text text) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  update public.learn_answers set transcript = p_text, status = 'transcribed'
  where id = p_id and kind = 'voice' and transcript is null;
  if found then
    return 'ok';
  end if;
  if exists (select 1 from public.learn_answers where id = p_id and kind = 'voice') then
    return 'duplicate';
  end if;
  return 'missing';
end;
$$;

create function public.learn_mark_failed(p_id uuid, p_error text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.learn_answers
  set status = 'failed', attempts = attempts + 1, last_error = left(p_error, 200)
  where id = p_id and status <> 'graded';
end;
$$;

revoke execute on function public.learn_save_grade(uuid, jsonb, jsonb),
  public.learn_save_takeaway(uuid, text, boolean, text, int, jsonb),
  public.learn_attach_transcript(uuid, text),
  public.learn_mark_failed(uuid, text)
  from public, anon, authenticated;
grant execute on function public.learn_save_grade(uuid, jsonb, jsonb),
  public.learn_save_takeaway(uuid, text, boolean, text, int, jsonb),
  public.learn_attach_transcript(uuid, text),
  public.learn_mark_failed(uuid, text)
  to service_role;

alter table public.learn_exercises enable row level security;
alter table public.learn_answers enable row level security;
alter table public.learn_grades enable row level security;
alter table public.learn_readings enable row level security;
alter table public.learn_grants enable row level security;

create policy learn_exercises_owner_read on public.learn_exercises for select to authenticated using (public.is_owner());
create policy learn_answers_owner_read on public.learn_answers for select to authenticated using (public.is_owner());
create policy learn_grades_owner_read on public.learn_grades for select to authenticated using (public.is_owner());
create policy learn_readings_owner_read on public.learn_readings for select to authenticated using (public.is_owner());
create policy learn_grants_owner_read on public.learn_grants for select to authenticated using (public.is_owner());

revoke all on public.learn_exercises, public.learn_answers, public.learn_grades, public.learn_readings, public.learn_grants
  from public, anon, authenticated;
grant select on public.learn_exercises, public.learn_answers, public.learn_grades, public.learn_readings, public.learn_grants
  to authenticated;
grant select, insert, update on public.learn_exercises, public.learn_answers, public.learn_grades, public.learn_readings,
  public.learn_grants to service_role;

alter table public.ai_usage drop constraint ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check check (feature in ('ideas', 'news', 'learn'));

-- No select, update or delete policy: only the service role reads clips, and an upload can never replace one.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('learn-voice', 'learn-voice', false, 15728640, array['audio/webm', 'audio/mp4', 'audio/ogg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy learn_voice_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'learn-voice' and name ~ '^answers/[0-9a-f-]{36}\.(webm|m4a|ogg)$' and public.is_owner());

select cron.schedule('hub-learn', '*/15 * * * *', $$ select public.hub_post_event('learn') $$);
