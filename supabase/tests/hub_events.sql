begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(17);

select has_extension('pg_cron', 'pg_cron is on');
select has_extension('pg_net', 'pg_net is on');
select results_eq(
  $$ select schedule, command from cron.job where jobname = 'hub-reminders' $$,
  $$ values ('*/5 * * * *'::text, ' select public.hub_post_event(''reminders'') '::text) $$,
  'reminders run every 5 minutes'
);
select results_eq(
  $$ select schedule, command from cron.job where jobname = 'hub-backup' $$,
  $$ values ('0 3 * * *'::text, ' select public.hub_post_event(''backup'') '::text) $$,
  'the backup runs daily at 03:00 UTC'
);
select ok(
  not has_function_privilege('anon', 'public.hub_post_event(text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.hub_post_event(text, jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.hub_post_event(text, jsonb)', 'execute'),
  'no API role can post an event directly'
);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'events-owner@example.com');
insert into public.hub_owner (user_id) values ('00000000-0000-0000-0000-0000000000e1');
insert into public.items (id, title, source, labels) values
  ('e0000000-0000-0000-0000-000000000001', 'approve me', 'test', '{todo}'),
  ('e0000000-0000-0000-0000-000000000002', 'approve me without secrets', 'test', '{todo}'),
  ('e0000000-0000-0000-0000-000000000003', 'claim me', 'test', '{todo}');

-- The real Vault may hold secrets from a manual check; this transaction rolls the removal back.
delete from vault.secrets where name in ('hub_events_url', 'hub_events_token');

create temporary table queue_before on commit drop as select coalesce(max(id), 0) as id from net.http_request_queue;
create function pg_temp.new_requests() returns setof net.http_request_queue
language sql as $$ select * from net.http_request_queue where id > (select id from queue_before) order by id $$;

select is(public.hub_post_event('reminders'), null, 'without secrets an event posts nothing');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select lives_ok(
  $$ update public.items set labels = '{todo,claude}' where id = 'e0000000-0000-0000-0000-000000000002' $$,
  'approving still works with no secrets set'
);
reset role;
select is((select count(*)::int from pg_temp.new_requests()), 0, 'without secrets the approval sends nothing');

select vault.create_secret('http://stub.test:9999/', 'hub_events_url');
select vault.create_secret('pgtap-token', 'hub_events_token');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
update public.items set labels = '{todo,claude}' where id = 'e0000000-0000-0000-0000-000000000001';
reset role;

select is((select count(*)::int from pg_temp.new_requests()), 1, 'approving sends one request');
select results_eq(
  $$ select method::text, url, convert_from(body, 'utf8')::jsonb, headers->>'Authorization' from pg_temp.new_requests() $$,
  $$ values ('POST'::text, 'http://stub.test:9999/api/hub/events/approved'::text,
             '{"id":"e0000000-0000-0000-0000-000000000001"}'::jsonb, 'Bearer pgtap-token'::text) $$,
  'the request posts the item id to the approved event with the token'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
update public.items set title = 'approve me, edited' where id = 'e0000000-0000-0000-0000-000000000001';
update public.items set labels = '{todo,claude}' where id = 'e0000000-0000-0000-0000-000000000003';
reset role;
select is((select count(*)::int from pg_temp.new_requests()), 2, 'editing an approved item sends nothing more');

set local role service_role;
select is(public.hub_claim('e0000000-0000-0000-0000-000000000003'), true, 'the worker claims the item');
reset role;
select is((select count(*)::int from pg_temp.new_requests()), 2, 'a claim keeps claude and sends nothing');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
insert into public.items (id, title, source, labels) values ('e0000000-0000-0000-0000-000000000004', 'born approved', 'test', '{claude}');
reset role;
select is(
  (select url from pg_temp.new_requests() order by id desc limit 1),
  'http://stub.test:9999/api/hub/events/approved',
  'adding an item already approved sends a request too'
);

select isnt(public.hub_post_event('backup'), null, 'with secrets an event posts');
select is(
  (select url from pg_temp.new_requests() order by id desc limit 1),
  'http://stub.test:9999/api/hub/events/backup',
  'the event name becomes the path'
);

-- A broken Vault or pg_net must never block Mason's edit; this stand-in fails the way they would.
create or replace function public.hub_post_event(p_event text, p_body jsonb default '{}') returns bigint
language plpgsql security definer set search_path = ''
as $$ begin raise exception 'pg_net is down'; end; $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select lives_ok(
  $$ update public.items set labels = '{todo}' where id = 'e0000000-0000-0000-0000-000000000002';
     update public.items set labels = '{todo,claude}' where id = 'e0000000-0000-0000-0000-000000000002' $$,
  'an approval still saves when the request cannot be queued'
);
reset role;

select * from finish();
rollback;
