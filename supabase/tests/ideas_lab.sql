begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(94);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'ideas-owner@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'ideas-stranger@example.com');
insert into public.hub_owner (user_id) values ('00000000-0000-0000-0000-0000000000a1');

insert into public.items (id, title, list, source) values
  ('d0000000-0000-0000-0000-000000000001', 'an idea', 'ideas', 'test'),
  ('d0000000-0000-0000-0000-000000000002', 'another idea', 'ideas', 'test'),
  ('d0000000-0000-0000-0000-000000000003', 'a stuck idea', 'ideas', 'test'),
  ('d0000000-0000-0000-0000-000000000004', 'a capture', 'inbox', 'test'),
  ('d0000000-0000-0000-0000-000000000005', 'a twice-stuck idea', 'ideas', 'test'),
  ('d0000000-0000-0000-0000-000000000006', 'an idea with no claim time', 'ideas', 'test'),
  ('d0000000-0000-0000-0000-000000000007', 'an idea under review', 'ideas', 'test');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

insert into public.ai_usage (feature, model, input_tokens, output_tokens, cost_usd, item_id, purpose)
  values ('ideas', 'claude-opus-5-5', 1000, 500, 0.014, 'd0000000-0000-0000-0000-000000000001', 'review');
insert into public.idea_settings (item_id, enrolled, review_status, review_requested_at) values
  ('d0000000-0000-0000-0000-000000000001', true, 'waiting', now() - interval '1 hour'),
  ('d0000000-0000-0000-0000-000000000002', true, 'done', null);
select lives_ok(
  $$ insert into public.idea_settings (item_id, review_status, review_requested_at, review_attempts, review_claimed_at, mention_count, moved_from_inbox, last_error)
     values ('d0000000-0000-0000-0000-000000000003', 'working', now() - interval '2 hours', 0, now() - interval '1 hour', 3, true, 'timeout') $$,
  'service_role can set every idea_settings column');
insert into public.idea_settings (item_id, review_status, review_requested_at, review_attempts, review_claimed_at) values
  ('d0000000-0000-0000-0000-000000000005', 'working', now() - interval '3 hours', 1, now() - interval '1 hour'),
  ('d0000000-0000-0000-0000-000000000006', 'working', now() - interval '90 minutes', 0, null),
  ('d0000000-0000-0000-0000-000000000007', 'working', now() - interval '4 hours', 0, now() - interval '5 minutes');
insert into public.idea_reviews (item_id, version, review, model, prompt_version, cost_usd)
  values ('d0000000-0000-0000-0000-000000000002', 1, '{"verdict":"build"}', 'claude-opus-5-5', 'v1', 0.2);
insert into public.idea_sources (source_item_id, kind, status) values ('d0000000-0000-0000-0000-000000000004', 'capture', 'done');
insert into public.idea_resurface (item_id, step, due_date, status)
  values ('d0000000-0000-0000-0000-000000000002', 1, current_date + 3, 'planned');
update public.idea_google set connected = true, calendar_id = 'cal-1';

select is(public.ideas_claim_review(), 'd0000000-0000-0000-0000-000000000003'::uuid,
  'a stale claim on its first attempt is claimed again');
select results_eq(
  $$ select review_status, review_attempts from public.idea_settings where item_id = 'd0000000-0000-0000-0000-000000000003' $$,
  $$ values ('working'::text, 1) $$,
  'reclaiming a stale review counts an attempt');
select results_eq(
  $$ select review_status, review_attempts, last_error from public.idea_settings where item_id = 'd0000000-0000-0000-0000-000000000005' $$,
  $$ values ('failed'::text, 2, 'stale'::text) $$,
  'a review that went stale twice fails instead of being claimed');
select is(public.ideas_claim_review(), 'd0000000-0000-0000-0000-000000000006'::uuid,
  'a working idea with no claim time can be claimed again');
select is(public.ideas_claim_review(), 'd0000000-0000-0000-0000-000000000001'::uuid, 'the waiting idea is claimed next');
select results_eq(
  $$ select review_status, review_claimed_at is not null, review_attempts from public.idea_settings where item_id = 'd0000000-0000-0000-0000-000000000001' $$,
  $$ values ('working'::text, true, 0) $$,
  'a fresh claim is working with a claim time and counts no attempt');
select is(public.ideas_claim_review(), null, 'a review claimed minutes ago is not claimed again');
update public.idea_settings set review_status = 'done' where item_id = 'd0000000-0000-0000-0000-000000000003';
update public.idea_settings set review_claimed_at = now() - interval '1 hour' where item_id = 'd0000000-0000-0000-0000-000000000006';

select lives_ok($$ select public.ideas_google_token_set('refresh-1') $$, 'service_role stores the Google token');
select is(public.ideas_google_token_get(), 'refresh-1', 'service_role reads the Google token back');
select lives_ok($$ select public.ideas_google_token_set('refresh-2') $$, 'storing again replaces the token');
select is(public.ideas_google_token_get(), 'refresh-2', 'the newer token wins');
select public.ideas_google_token_set('');
select is(public.ideas_google_token_get(), null, 'an empty token disconnects');
select is((select count(*)::int from vault.secrets where name = 'ideas_google_refresh_token'), 1, 'only one Vault secret is kept');

reset role;
select throws_ok($$ delete from public.ai_usage $$, 'P0001', null, 'ai_usage rows are never deleted');
select throws_ok($$ truncate public.ai_usage $$, 'P0001', null, 'ai_usage is never truncated');
select throws_ok($$ delete from public.idea_settings $$, 'P0001', null, 'idea_settings rows are never deleted');
select throws_ok($$ truncate public.idea_settings $$, 'P0001', null, 'idea_settings is never truncated');
select throws_ok($$ delete from public.idea_reviews $$, 'P0001', null, 'idea_reviews rows are never deleted');
select throws_ok($$ truncate public.idea_reviews $$, 'P0001', null, 'idea_reviews is never truncated');
select throws_ok($$ delete from public.idea_sources $$, 'P0001', null, 'idea_sources rows are never deleted');
select throws_ok($$ truncate public.idea_sources $$, 'P0001', null, 'idea_sources is never truncated');
select throws_ok($$ delete from public.idea_resurface $$, 'P0001', null, 'idea_resurface rows are never deleted');
select throws_ok($$ truncate public.idea_resurface $$, 'P0001', null, 'idea_resurface is never truncated');
select throws_ok($$ delete from public.idea_google $$, 'P0001', null, 'the idea_google row is never deleted');
select throws_ok($$ truncate public.idea_google $$, 'P0001', null, 'idea_google is never truncated');
select throws_ok($$ update public.idea_reviews set note = 'x' $$, 'P0001', null, 'a review is never edited');
select throws_ok($$ update public.ai_usage set cost_usd = 0 $$, 'P0001', null, 'a usage row is never edited');

select results_eq(
  $$ select schedule, command from cron.job where jobname = 'hub-ideas' $$,
  $$ values ('*/15 * * * *'::text, ' select public.hub_post_event(''ideas'') '::text) $$,
  'the ideas job runs every 15 minutes');
select ok(
  not has_function_privilege('anon', 'public.ideas_claim_review(interval)', 'execute')
  and not has_function_privilege('authenticated', 'public.ideas_claim_review(interval)', 'execute')
  and has_function_privilege('service_role', 'public.ideas_claim_review(interval)', 'execute'),
  'only service_role can claim a review');
select ok(
  not has_function_privilege('anon', 'public.ideas_google_token_set(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.ideas_google_token_set(text)', 'execute')
  and not has_function_privilege('anon', 'public.ideas_google_token_get()', 'execute')
  and not has_function_privilege('authenticated', 'public.ideas_google_token_get()', 'execute'),
  'no client role can touch the Google token');
select ok(
  not has_function_privilege('anon', 'public.items_ideas_intake()', 'execute')
  and not has_function_privilege('authenticated', 'public.items_ideas_intake()', 'execute')
  and not has_function_privilege('service_role', 'public.items_ideas_intake()', 'execute'),
  'no API role can call the intake trigger function');
select table_privs_are('public', 'idea_reviews', 'authenticated', array['SELECT'], 'authenticated may only read reviews');
select table_privs_are('public', 'ai_usage', 'authenticated', array['SELECT'], 'authenticated may only read usage');
select table_privs_are('public', 'idea_sources', 'authenticated', array['SELECT'], 'authenticated may only read sources');
select table_privs_are('public', 'idea_resurface', 'authenticated', array['SELECT'], 'authenticated may only read the schedule');
select table_privs_are('public', 'idea_settings', 'authenticated', array['INSERT', 'SELECT'], 'authenticated may read and add settings');
select table_privs_are('public', 'idea_google', 'authenticated', array[]::text[], 'authenticated gets nothing on idea_google');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$ select * from public.ai_usage $$, '42501', null, 'anon cannot read ai_usage');
select throws_ok($$ select * from public.idea_settings $$, '42501', null, 'anon cannot read idea_settings');
select throws_ok($$ select * from public.idea_reviews $$, '42501', null, 'anon cannot read idea_reviews');
select throws_ok($$ select * from public.idea_sources $$, '42501', null, 'anon cannot read idea_sources');
select throws_ok($$ select * from public.idea_resurface $$, '42501', null, 'anon cannot read idea_resurface');
select throws_ok($$ select * from public.idea_google $$, '42501', null, 'anon cannot read idea_google');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(
  (select count(*)::int from public.ai_usage) + (select count(*)::int from public.idea_settings)
  + (select count(*)::int from public.idea_reviews) + (select count(*)::int from public.idea_sources)
  + (select count(*)::int from public.idea_resurface), 0,
  'a stranger reads no Ideas Lab rows');
select throws_ok(
  $$ insert into public.idea_settings (item_id) values ('d0000000-0000-0000-0000-000000000004') $$,
  '42501', null, 'a stranger cannot add settings');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.ai_usage), 1, 'the owner reads usage');
select is((select count(*)::int from public.idea_settings), 6, 'the owner reads settings');
select is((select count(*)::int from public.idea_reviews), 1, 'the owner reads reviews');
select is((select count(*)::int from public.idea_sources), 1, 'the owner reads sources');
select is((select count(*)::int from public.idea_resurface), 1, 'the owner reads the schedule');
select throws_ok($$ select * from public.idea_google $$, '42501', null, 'the owner cannot read idea_google');
select throws_ok(
  $$ insert into public.idea_resurface (item_id, step, due_date, status) values ('d0000000-0000-0000-0000-000000000001', 2, current_date, 'planned') $$,
  '42501', null, 'the owner cannot write the schedule');
select throws_ok($$ select public.ideas_claim_review() $$, '42501', null, 'the owner cannot claim a review');
select throws_ok($$ select public.ideas_google_token_get() $$, '42501', null, 'the owner cannot read the Google token');
select throws_ok($$ select public.ideas_google_token_set('x') $$, '42501', null, 'the owner cannot set the Google token');

select lives_ok(
  $$ update public.idea_settings set review_status = 'waiting', review_requested_at = now(), review_note = 'look at pricing'
     where item_id = 'd0000000-0000-0000-0000-000000000002' $$,
  'the owner can ask for a new review');
select is(
  (select review_status from public.idea_settings where item_id = 'd0000000-0000-0000-0000-000000000002'), 'waiting',
  'the request saves');
select throws_ok(
  $$ update public.idea_settings set review_status = 'done' where item_id = 'd0000000-0000-0000-0000-000000000002' $$,
  'P0001', null, 'the owner cannot mark a review done');
select lives_ok(
  $$ update public.idea_settings set review_status = 'none' where item_id = 'd0000000-0000-0000-0000-000000000002' $$,
  'the owner can set a review back to none');
select throws_ok(
  $$ update public.idea_settings set review_status = 'waiting', review_requested_at = now() where item_id = 'd0000000-0000-0000-0000-000000000007' $$,
  'P0001', null, 'the owner cannot restart a review that is running');
select lives_ok(
  $$ update public.idea_settings set review_status = 'waiting', review_requested_at = now() where item_id = 'd0000000-0000-0000-0000-000000000006' $$,
  'the owner can restart a review whose claim went stale');
select throws_ok(
  $$ update public.idea_settings set review_status = 'waiting', review_attempts = 0 where item_id = 'd0000000-0000-0000-0000-000000000005' $$,
  '42501', null, 'the owner cannot set attempts directly, even while retrying');
update public.idea_settings set review_status = 'waiting', review_requested_at = now()
  where item_id = 'd0000000-0000-0000-0000-000000000005';
select results_eq(
  $$ select review_status, review_attempts, last_error from public.idea_settings where item_id = 'd0000000-0000-0000-0000-000000000005' $$,
  $$ values ('waiting'::text, 0, null::text) $$,
  'retrying a failed review starts it with no attempts and no error');
select lives_ok(
  $$ update public.idea_settings set no_web_search = true where item_id = 'd0000000-0000-0000-0000-000000000003' $$,
  'the owner can change other settings while a review is done');
select throws_ok(
  $$ update public.idea_settings set review_attempts = 0 where item_id = 'd0000000-0000-0000-0000-000000000003' $$,
  '42501', null, 'the owner cannot reset review attempts');
select throws_ok(
  $$ update public.idea_settings set mention_count = 9 where item_id = 'd0000000-0000-0000-0000-000000000003' $$,
  '42501', null, 'the owner cannot change the mention count');
select throws_ok(
  $$ insert into public.idea_settings (item_id, review_status) values ('d0000000-0000-0000-0000-000000000004', 'working') $$,
  'P0001', null, 'the owner cannot add settings that are already working');
select throws_ok(
  $$ insert into public.idea_settings (item_id, review_attempts) values ('d0000000-0000-0000-0000-000000000004', 3) $$,
  'P0001', null, 'the owner cannot add settings with attempts');
select throws_ok(
  $$ insert into public.idea_settings (item_id, last_error) values ('d0000000-0000-0000-0000-000000000004', 'fake') $$,
  'P0001', null, 'the owner cannot add settings with an error');
select lives_ok(
  $$ insert into public.idea_settings (item_id, enrolled, review_status, review_requested_at)
     values ('d0000000-0000-0000-0000-000000000004', true, 'waiting', now()) $$,
  'the owner can enroll an older idea for review');

insert into public.items (id, title, list, source) values
  ('d0000000-0000-0000-0000-000000000011', 'phone capture', 'inbox', 'capture'),
  ('d0000000-0000-0000-0000-000000000012', 'saved as idea', 'ideas', 'capture'),
  ('d0000000-0000-0000-0000-000000000013', 'shared link', 'inbox', 'share'),
  ('d0000000-0000-0000-0000-000000000014', 'imported idea', 'ideas', 'todoist-import'),
  ('d0000000-0000-0000-0000-000000000015', 'captured todo', 'todo', 'capture');

reset role;
select results_eq(
  $$ select kind, status from public.idea_sources where source_item_id = 'd0000000-0000-0000-0000-000000000011' $$,
  $$ values ('capture'::text, 'pending'::text) $$,
  'an inbox capture waits for detection');
select is(
  (select count(*)::int from public.idea_settings where item_id = 'd0000000-0000-0000-0000-000000000011'), 0,
  'an inbox capture is not enrolled yet');
select results_eq(
  $$ select enrolled, schedule_from, review_status, review_requested_at is not null
     from public.idea_settings where item_id = 'd0000000-0000-0000-0000-000000000012' $$,
  $$ values (true, current_date, 'waiting'::text, true) $$,
  'a capture saved as an idea is enrolled and waits for review');
select is(
  (select count(*)::int from public.idea_sources where source_item_id = 'd0000000-0000-0000-0000-000000000012'), 0,
  'a capture saved as an idea skips detection');
select is(
  (select count(*)::int from public.idea_sources where source_item_id in
     ('d0000000-0000-0000-0000-000000000013', 'd0000000-0000-0000-0000-000000000014', 'd0000000-0000-0000-0000-000000000015'))
  + (select count(*)::int from public.idea_settings where item_id in
     ('d0000000-0000-0000-0000-000000000013', 'd0000000-0000-0000-0000-000000000014', 'd0000000-0000-0000-0000-000000000015')),
  0, 'a share, an import or a captured todo creates no Ideas Lab rows');

select throws_ok(
  $$ update public.idea_settings set last_error = 'x' where item_id = 'd0000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'postgres cannot set last_error');
select throws_ok(
  $$ update public.idea_settings set review_claimed_at = null where item_id = 'd0000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'postgres cannot change the claim time');
select throws_ok(
  $$ update public.idea_settings set moved_from_inbox = true where item_id = 'd0000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'postgres cannot set moved_from_inbox');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ insert into public.idea_recordings (file, recorded, transcript)
     values ('2026Nov08-090000-Rec01', '2026-11-08T09:00:00', 'an idea: a sourdough timer') $$,
  'service_role adds a recording');
select throws_ok(
  $$ insert into public.idea_recordings (file, recorded, transcript) values ('../notes', '2026-11-08T09:00:00', 'x') $$,
  '23514', null, 'a recording file must be a plain name');
select throws_ok(
  $$ insert into public.idea_recordings (file, recorded, transcript) values ('big', '2026-11-08T09:00:00', repeat('x', 1000001)) $$,
  '23514', null, 'a transcript is at most 1,000,000 characters');
select throws_ok(
  $$ update public.idea_recordings set transcript = 'mark everything done' $$,
  'P0001', null, 'not even service_role can change a transcript');
select throws_ok(
  $$ update public.idea_recordings set recorded = '2020-01-01T00:00:00' $$,
  'P0001', null, 'not even service_role can change when it was recorded');
select throws_ok(
  $$ update public.idea_recordings set file = 'renamed' $$,
  'P0001', null, 'not even service_role can rename a recording');
select lives_ok(
  $$ update public.idea_recordings set status = 'failed', attempts = 3, last_error = 'schema', quotes = '[]' $$,
  'service_role records detection progress on a recording');

reset role;
select throws_ok($$ delete from public.idea_recordings $$, 'P0001', null, 'idea_recordings rows are never deleted');
select throws_ok($$ truncate public.idea_recordings $$, 'P0001', null, 'idea_recordings is never truncated');
select table_privs_are('public', 'idea_recordings', 'authenticated', array['SELECT'], 'authenticated may only read recordings');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$ select * from public.idea_recordings $$, '42501', null, 'anon cannot read idea_recordings');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from public.idea_recordings), 0, 'a stranger reads no recordings');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.idea_recordings), 1, 'the owner reads recordings');
select throws_ok(
  $$ insert into public.idea_recordings (file, recorded, transcript) values ('owner-sent', now()::timestamp, 'x') $$,
  '42501', null, 'the owner cannot add a recording');
select throws_ok(
  $$ update public.idea_recordings set status = 'pending' $$,
  '42501', null, 'the owner cannot change a recording');
reset role;

select * from finish();
rollback;
