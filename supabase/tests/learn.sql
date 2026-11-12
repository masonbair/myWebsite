begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(57);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a4', 'learn-owner@example.com'),
  ('00000000-0000-0000-0000-0000000000b4', 'learn-stranger@example.com');
insert into public.hub_owner (user_id) values ('00000000-0000-0000-0000-0000000000a4')
  on conflict do nothing;

-- Day one: four exercises, one typed answer each. Day two: one exercise and a voice answer. Day three: one exercise.
insert into public.learn_exercises (id, date, position, type, topic, question, reading_title, reading_url, reading_summary, model) values
  ('e1000000-0000-0000-0000-000000000001', '2026-11-13', 1, 'explain', 'explain-simply', 'Explain DNS to a baker.', 'The curse of knowledge', 'https://hbr.org/a', 'Experts forget what it is like not to know.', 'claude-sonnet-5-5'),
  ('e1000000-0000-0000-0000-000000000002', '2026-11-13', 2, 'scenario', 'value', 'What job is the gym owner hiring the app for?', 'Jobs to be done', 'https://hbr.org/b', 'People hire products to get a job done.', 'claude-sonnet-5-5'),
  ('e1000000-0000-0000-0000-000000000003', '2026-11-13', 3, 'scenario', 'products', 'Which feature would you cut first and why?', 'Reading three', 'https://example.com/c', 'A summary of reading three.', 'claude-sonnet-5-5'),
  ('e1000000-0000-0000-0000-000000000004', '2026-11-13', 4, 'scenario', 'value', 'Where do you bring the most value this week?', 'Reading four', 'https://example.com/d', 'A summary of reading four.', 'claude-sonnet-5-5'),
  ('e2000000-0000-0000-0000-000000000001', '2026-11-14', 1, 'voice', 'communication', 'Tell a client the launch slips a week.', 'Reading five', 'https://example.com/e', 'A summary of reading five.', 'claude-sonnet-5-5'),
  ('e3000000-0000-0000-0000-000000000001', '2026-11-15', 1, 'explain', 'explain-simply', 'Explain a database to a florist.', 'Reading six', 'https://example.com/f', 'A summary of reading six.', 'claude-sonnet-5-5');

insert into public.learn_answers (id, exercise_id, kind, body, status) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'typed', 'Answer one', 'grading'),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'typed', 'Answer two', 'grading'),
  ('a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003', 'typed', 'Answer three', 'grading'),
  ('a1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000004', 'typed', 'Answer four', 'grading'),
  ('a3000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'typed', 'Answer six', 'grading');
insert into public.learn_answers (id, exercise_id, kind, clip_path, clip_mime, clip_duration_ms, status) values
  ('a2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'voice',
   'answers/a2000000-0000-0000-0000-000000000001.webm', 'audio/webm', 42000, 'awaiting_transcript');

-- A grade object and a grant object as the server sends them; the signature is a well-formed stand-in.
create function pg_temp.grade(p_minutes int) returns jsonb language sql as $$
  select jsonb_build_object('grade', 'A', 'worked', 'Led with the outcome.', 'fix', 'Drop the acronym.',
    'better', 'A better version.', 'resources', '[]'::jsonb, 'jargon_opening', false, 'delivery', null,
    'minutes', p_minutes, 'late', false, 'model', 'claude-opus-5-5')
$$;
create function pg_temp.grant_of(p_date text, p_minutes int, p_nonce text) returns jsonb language sql as $$
  select jsonb_build_object('date', p_date, 'minutes', p_minutes, 'nonce', p_nonce,
    'msg', 'fl-grant-v1|' || p_date || '|com.instagram.android|' || p_minutes || '|' || p_nonce,
    'sig', repeat('A', 86) || '==')
$$;

-- Reads: the owner sees every table, a stranger sees nothing, anon has no grant at all.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from public.learn_exercises), 6, 'owner reads learn_exercises');
select is((select count(*)::int from public.learn_answers), 6, 'owner reads learn_answers');
select lives_ok($$ select * from public.learn_grades $$, 'owner reads learn_grades');
select lives_ok($$ select * from public.learn_readings $$, 'owner reads learn_readings');
select lives_ok($$ select * from public.learn_grants $$, 'owner reads learn_grants');

-- Writes: the owner can never write a learn row or call the save functions.
select throws_ok($$ insert into public.learn_answers (exercise_id, kind, body, status)
  values ('e3000000-0000-0000-0000-000000000001', 'typed', 'x', 'grading') $$, '42501', null, 'owner cannot insert an answer');
select throws_ok($$ insert into public.learn_grades (answer_id, grade, worked, fix, better, resources, minutes)
  values ('a1000000-0000-0000-0000-000000000001', 'A', 'w', 'f', 'b', '[]', 4) $$, '42501', null, 'owner cannot insert a grade');
select throws_ok($$ insert into public.learn_grants (date, package, minutes, nonce, msg, sig, answer_id)
  values ('2026-11-13', 'com.instagram.android', 4, 'AAAAAAAAAAAAAAAAAAAAAA', 'x', 'y', 'a1000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'owner cannot insert a grant');
select throws_ok($$ insert into public.learn_readings (exercise_id, takeaway, accepted, feedback, minutes)
  values ('e1000000-0000-0000-0000-000000000001', 't', true, 'f', 1) $$, '42501', null, 'owner cannot insert a reading');
select throws_ok($$ update public.learn_grants set minutes = 10 $$, '42501', null, 'owner cannot update a grant');
select throws_ok($$ update public.learn_answers set status = 'graded' $$, '42501', null, 'owner cannot update an answer');
select throws_ok($$ select public.learn_save_grade('a1000000-0000-0000-0000-000000000001', pg_temp.grade(4), null) $$,
  '42501', null, 'owner cannot call learn_save_grade');
select throws_ok($$ select public.learn_save_takeaway('e1000000-0000-0000-0000-000000000001', 't', true, 'f', 1, null) $$,
  '42501', null, 'owner cannot call learn_save_takeaway');
select throws_ok($$ select public.learn_attach_transcript('a2000000-0000-0000-0000-000000000001', 'hi') $$,
  '42501', null, 'owner cannot call learn_attach_transcript');
select throws_ok($$ select public.learn_mark_failed('a1000000-0000-0000-0000-000000000001', 'x') $$,
  '42501', null, 'owner cannot call learn_mark_failed');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select is((select count(*)::int from public.learn_exercises), 0, 'a stranger sees no exercises');
select is((select count(*)::int from public.learn_answers), 0, 'a stranger sees no answers');
select is((select count(*)::int from public.learn_grants), 0, 'a stranger sees no grants');
reset role;

set local role anon;
select throws_ok($$ select * from public.learn_grants $$, '42501', null, 'anon cannot read grants');
select throws_ok($$ select * from public.learn_exercises $$, '42501', null, 'anon cannot read exercises');
reset role;

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'learn\_%' and not c.relrowsecurity),
  0, 'every learn table has RLS on');
select is(
  (select array_agg(distinct privilege_type::text) from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'learn\_%' and grantee = 'authenticated'),
  array['SELECT'], 'authenticated may only select on learn tables');

-- Saving a grade and its grant: once, as the service role, in one step.
set local role service_role;
select is(public.learn_save_grade('a1000000-0000-0000-0000-000000000001', pg_temp.grade(4),
  pg_temp.grant_of('2026-11-13', 4, 'n1aaaaaaaaaaaaaaaaaaaa')), 'ok', 'a grade with a grant saves');
select is(public.learn_save_grade('a1000000-0000-0000-0000-000000000001', pg_temp.grade(4),
  pg_temp.grant_of('2026-11-13', 4, 'n1bbbbbbbbbbbbbbbbbbbb')), 'duplicate', 'a second save for the same answer is a duplicate');
select is((select count(*)::int from public.learn_grades where answer_id = 'a1000000-0000-0000-0000-000000000001'), 1, 'one grade row');
select is((select count(*)::int from public.learn_grants where answer_id = 'a1000000-0000-0000-0000-000000000001'), 1, 'one grant row');
select is((select status from public.learn_answers where id = 'a1000000-0000-0000-0000-000000000001'), 'graded', 'the answer is graded');

-- Malformed grants never store, and the grade is not left behind without them.
select throws_ok($$ select public.learn_save_grade('a1000000-0000-0000-0000-000000000002', pg_temp.grade(4),
  pg_temp.grant_of('2026-11-13', 4, 'n2aaaaaaaaaaaaaaaaaaaa') || '{"msg":"fl-grant-v1|2026-11-13|com.instagram.android|9|n2aaaaaaaaaaaaaaaaaaaa"}') $$,
  '23514', null, 'a grant whose msg does not match its columns is refused');
select throws_ok($$ select public.learn_save_grade('a1000000-0000-0000-0000-000000000002', pg_temp.grade(4),
  pg_temp.grant_of('2026-11-13', 4, 'short')) $$, '23514', null, 'a short nonce is refused');
select throws_ok($$ select public.learn_save_grade('a1000000-0000-0000-0000-000000000002', pg_temp.grade(4),
  pg_temp.grant_of('2026-11-13', 4, 'n2aaaaaaaaaaaaaaaaaaaa') || '{"package":"com.other"}') $$, '23514', null, 'another package is refused');
select throws_ok($$ select public.learn_save_grade('a1000000-0000-0000-0000-000000000002', pg_temp.grade(0),
  pg_temp.grant_of('2026-11-13', 0, 'n2aaaaaaaaaaaaaaaaaaaa')) $$, '23514', null, 'a zero-minute grant is refused');
select throws_ok($$ select public.learn_save_grade('a1000000-0000-0000-0000-000000000002', pg_temp.grade(4),
  pg_temp.grant_of('2026-11-13', 4, 'n1aaaaaaaaaaaaaaaaaaaa')) $$, '23505', null, 'a reused nonce is refused');
select is((select count(*)::int from public.learn_grades where answer_id = 'a1000000-0000-0000-0000-000000000002'), 0,
  'no grade is left behind when its grant is refused');

-- The daily cap of 10 holds in the database: 4 + 4 + 3 fails, 4 + 4 + 2 passes, another day starts fresh.
select is(public.learn_save_grade('a1000000-0000-0000-0000-000000000002', pg_temp.grade(4),
  pg_temp.grant_of('2026-11-13', 4, 'n2aaaaaaaaaaaaaaaaaaaa')), 'ok', 'a second 4-minute grant saves');
select throws_like($$ select public.learn_save_grade('a1000000-0000-0000-0000-000000000003', pg_temp.grade(3),
  pg_temp.grant_of('2026-11-13', 3, 'n3aaaaaaaaaaaaaaaaaaaa')) $$, '%cap%', 'a third grant past 10 minutes is refused');
select is(public.learn_save_grade('a1000000-0000-0000-0000-000000000003', pg_temp.grade(2),
  pg_temp.grant_of('2026-11-13', 2, 'n3bbbbbbbbbbbbbbbbbbbb')), 'ok', 'a grant that lands exactly on 10 saves');
select is((select sum(minutes)::int from public.learn_grants where date = '2026-11-13'), 10, 'the day sums to 10');
select is(public.learn_save_grade('a1000000-0000-0000-0000-000000000004', pg_temp.grade(4), null), 'ok',
  'a grade with no grant still saves');
select is(public.learn_save_grade('a3000000-0000-0000-0000-000000000001', pg_temp.grade(4),
  pg_temp.grant_of('2026-11-15', 4, 'n6aaaaaaaaaaaaaaaaaaaa')), 'ok', 'another day has its own cap');

-- Reading takeaways earn at most 1 minute and save once.
select is(public.learn_save_takeaway('e3000000-0000-0000-0000-000000000001', 'Start from what they know.', true, 'Good.', 1,
  pg_temp.grant_of('2026-11-15', 1, 'r6aaaaaaaaaaaaaaaaaaaa')), 'ok', 'an accepted takeaway saves with its grant');
select is(public.learn_save_takeaway('e3000000-0000-0000-0000-000000000001', 'Again.', true, 'Good.', 1,
  pg_temp.grant_of('2026-11-15', 1, 'r6bbbbbbbbbbbbbbbbbbbb')), 'duplicate', 'a second takeaway for the card is a duplicate');

-- Transcripts attach once, only to voice answers; an empty transcript counts.
select is(public.learn_attach_transcript('a2000000-0000-0000-0000-000000000001', ''), 'ok', 'an empty transcript attaches');
select is((select status from public.learn_answers where id = 'a2000000-0000-0000-0000-000000000001'), 'transcribed', 'the clip is transcribed');
select is(public.learn_attach_transcript('a2000000-0000-0000-0000-000000000001', 'again'), 'duplicate', 'a second transcript is a duplicate');
select is(public.learn_attach_transcript('a9999999-0000-0000-0000-000000000001', 'x'), 'missing', 'an unknown id is missing');
select is(public.learn_attach_transcript('a1000000-0000-0000-0000-000000000004', 'x'), 'missing', 'a typed answer takes no transcript');

-- Answers keep what was sent; nothing learn is ever deleted.
select throws_ok($$ update public.learn_answers set body = 'changed' where id = 'a1000000-0000-0000-0000-000000000004' $$,
  'P0001', null, 'an answer body never changes');
select throws_ok($$ update public.learn_answers set transcript = 'changed' where id = 'a2000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'a transcript never changes once set');
select throws_ok($$ delete from public.learn_grants $$, 'P0001', null, 'grants are never deleted');
select throws_ok($$ delete from public.learn_answers $$, 'P0001', null, 'answers are never deleted');
select throws_ok($$ truncate public.learn_exercises cascade $$, 'P0001', null, 'exercises are never truncated');

select lives_ok($$ insert into public.ai_usage (feature, model, cost_usd, purpose) values ('learn', 'claude-opus-5-5', 0.01, 'grade') $$,
  'ai_usage accepts the learn feature');
reset role;

-- Voice clips: the owner may only add files named answers/<uuid>.<ext> to learn-voice.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('learn-voice', 'answers/a2000000-0000-0000-0000-000000000009.webm') $$,
  'the owner uploads a voice clip');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('learn-voice', 'answers/../x.webm') $$,
  '42501', null, 'a path that climbs out is refused');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('learn-voice', 'other/a2000000-0000-0000-0000-000000000009.webm') $$,
  '42501', null, 'a path outside answers/ is refused');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('learn-voice', 'answers/a2000000-0000-0000-0000-00000000000a.webm') $$,
  '42501', null, 'a stranger cannot upload a voice clip');
reset role;

select is((select count(*)::int from cron.job where jobname = 'hub-learn'), 1, 'the learn event is scheduled');

select * from finish();
rollback;
