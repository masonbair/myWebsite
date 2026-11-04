begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(59);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'stranger@example.com');
insert into public.hub_owner (user_id) values ('00000000-0000-0000-0000-00000000000a');

-- Fixtures need claude labels, a done item and a mason comment, which only the signed-in owner may write.
alter table public.items disable trigger user;
alter table public.comments disable trigger user;
insert into public.items (id, title, source, labels, state) values
  ('10000000-0000-0000-0000-000000000001', 'survivor', 'test', '{}', 'open'),
  ('10000000-0000-0000-0000-000000000002', 'to complete', 'test', '{}', 'open'),
  ('10000000-0000-0000-0000-000000000003', 'duplicate', 'test', '{}', 'open'),
  ('10000000-0000-0000-0000-000000000004', 'approved for claude', 'test', '{todo,claude,claude-done}', 'open'),
  ('10000000-0000-0000-0000-000000000005', 'worker finishes', 'test', '{claude,claude-working}', 'open'),
  ('10000000-0000-0000-0000-000000000006', 'worker blocks', 'test', '{claude,claude-working}', 'open'),
  ('10000000-0000-0000-0000-000000000007', 'approval dropped', 'test', '{todo,claude}', 'open'),
  ('10000000-0000-0000-0000-000000000008', 'done and approved', 'test', '{claude}', 'done');
insert into public.comments (id, item_id, body, author) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'hello', 'mason'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'from the worker', 'worker');
alter table public.items enable trigger user;
alter table public.comments enable trigger user;
insert into public.hub_state (key, value) values ('cursor', '{"n":1}');
insert into public.memo_files (file, device) values ('memo-1.wav', 'hidock');
insert into public.audit_log (actor, action) values ('worker', 'test');

select throws_ok($$ delete from public.items $$, 'P0001', null, 'postgres cannot delete items');
select throws_ok($$ delete from public.comments $$, 'P0001', null, 'postgres cannot delete comments');
select throws_ok($$ delete from public.hub_owner $$, 'P0001', null, 'postgres cannot delete hub_owner');
select throws_ok($$ delete from public.hub_state $$, 'P0001', null, 'postgres cannot delete hub_state');
select throws_ok($$ delete from public.memo_files $$, 'P0001', null, 'postgres cannot delete memo_files');
select throws_ok($$ delete from public.audit_log $$, 'P0001', null, 'postgres cannot delete audit_log');
select throws_ok($$ truncate public.items cascade $$, 'P0001', null, 'postgres cannot truncate items');
select throws_ok($$ truncate public.comments $$, 'P0001', null, 'postgres cannot truncate comments');
select throws_ok($$ truncate public.hub_owner $$, 'P0001', null, 'postgres cannot truncate hub_owner');
select throws_ok($$ truncate public.hub_state $$, 'P0001', null, 'postgres cannot truncate hub_state');
select throws_ok($$ truncate public.memo_files $$, 'P0001', null, 'postgres cannot truncate memo_files');
select throws_ok($$ truncate public.audit_log $$, 'P0001', null, 'postgres cannot truncate audit_log');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(public.is_owner(), false, 'service_role is not the owner');
select throws_ok($$ delete from public.items $$, 'P0001', null, 'service_role cannot delete items');
select throws_ok($$ delete from public.comments $$, 'P0001', null, 'service_role cannot delete comments');
select throws_ok(
  $$ update public.items set state = 'done' where id = '10000000-0000-0000-0000-000000000002' $$,
  'P0001', null, 'service_role cannot complete an item');
select throws_ok(
  $$ insert into public.items (title, source, state) values ('sneaky', 'test', 'done') $$,
  'P0001', null, 'service_role cannot insert an item already done');
select throws_ok(
  $$ update public.items set state = 'archived' where id = '10000000-0000-0000-0000-000000000003' $$,
  'P0001', null, 'archiving without a reason raises');
select throws_ok(
  $$ update public.items set state = 'archived', archived_reason = 'merged' where id = '10000000-0000-0000-0000-000000000003' $$,
  'P0001', null, 'archiving as merged without merged_into raises');
select lives_ok(
  $$ update public.items set state = 'archived', archived_reason = 'merged',
       merged_into = '10000000-0000-0000-0000-000000000001'
     where id = '10000000-0000-0000-0000-000000000003' $$,
  'archiving as merged with merged_into succeeds');
select is(
  (select state from public.items where id = '10000000-0000-0000-0000-000000000003'),
  'archived', 'merged duplicate is archived');

select is(public.hub_claim('10000000-0000-0000-0000-000000000004'), true, 'first claim wins');
select is(public.hub_claim('10000000-0000-0000-0000-000000000004'), false, 'second claim loses');
select is(
  (select labels from public.items where id = '10000000-0000-0000-0000-000000000004'),
  array['todo', 'claude', 'claude-working'], 'claim swaps status labels to claude-working');
select is(
  public.hub_claim('10000000-0000-0000-0000-000000000001'), false,
  'cannot claim an item without the claude label');
select is(
  public.hub_claim('10000000-0000-0000-0000-000000000008'), false,
  'cannot claim an item that is not open');

select throws_ok(
  $$ insert into public.items (title, source, labels) values ('self approved', 'test', '{claude}') $$,
  'P0001', null, 'service_role cannot insert an item with claude');
select throws_ok(
  $$ update public.items set labels = '{claude}' where id = '10000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'service_role cannot add claude');
select lives_ok(
  $$ update public.items set labels = '{claude-done}' where id = '10000000-0000-0000-0000-000000000005' $$,
  'worker can drop claude when finishing');
select lives_ok(
  $$ update public.items set labels = '{claude-question}' where id = '10000000-0000-0000-0000-000000000006' $$,
  'worker can drop claude when blocking');
select throws_ok(
  $$ update public.items set labels = '{todo}' where id = '10000000-0000-0000-0000-000000000007' $$,
  'P0001', null, 'service_role cannot drop claude otherwise');

select throws_ok(
  $$ insert into public.comments (item_id, body, author)
     values ('10000000-0000-0000-0000-000000000001', 'pretending', 'mason') $$,
  'P0001', null, 'service_role cannot comment as mason');
select lives_ok(
  $$ insert into public.comments (item_id, body, author)
     values ('10000000-0000-0000-0000-000000000001', 'worker note', 'worker') $$,
  'service_role can comment as worker');
select throws_ok(
  $$ update public.comments set author = 'mason' where id = '20000000-0000-0000-0000-000000000002' $$,
  'P0001', null, 'service_role cannot relabel a comment as mason');

reset role;
update public.items
  set labels = '{claude,claude-working}', state = 'open'
  where id = '10000000-0000-0000-0000-000000000004';
alter table public.items disable trigger items_guard_state;
update public.items set updated_at = now() - interval '3 hours'
  where id = '10000000-0000-0000-0000-000000000004';
alter table public.items enable trigger items_guard_state;
set local role service_role;
select is(public.hub_claim('10000000-0000-0000-0000-000000000004'), true, 'stale claim can be retaken');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(public.is_owner(), true, 'owner is recognised');
select is((select count(*)::int from public.items), 8, 'owner sees every item');
select lives_ok(
  $$ update public.items set state = 'done' where id = '10000000-0000-0000-0000-000000000002' $$,
  'owner can complete an item');
select isnt(
  (select completed_at from public.items where id = '10000000-0000-0000-0000-000000000002'),
  null, 'completing sets completed_at');
select throws_ok($$ delete from public.items $$, null, null, 'owner cannot delete items');
select lives_ok(
  $$ insert into public.comments (item_id, body, author)
     values ('10000000-0000-0000-0000-000000000002', 'done it', 'mason') $$,
  'owner can comment');
select lives_ok(
  $$ update public.items set labels = '{claude}' where id = '10000000-0000-0000-0000-000000000001' $$,
  'owner can approve an item for claude');
select lives_ok(
  $$ update public.items set labels = '{todo}' where id = '10000000-0000-0000-0000-000000000007' $$,
  'owner can remove claude');

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$ update public.items set state = 'open' where id = '10000000-0000-0000-0000-000000000002' $$,
  'P0001', null, 'service_role cannot reopen a done item');
select throws_ok(
  $$ update public.items set state = 'archived', archived_reason = 'memo-split' where id = '10000000-0000-0000-0000-000000000002' $$,
  'P0001', null, 'service_role cannot archive a done item');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select throws_ok(
  $$ update public.items set state = 'done' where id = '10000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'service_role with forged owner claims cannot complete an item');
set local request.jwt.claims = '{"role":"service_role"}';

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select is((select count(*)::int from public.items), 0, 'stranger sees no items');
select is((select count(*)::int from public.comments), 0, 'stranger sees no comments');
select throws_ok(
  $$ insert into public.items (title, source) values ('intruder', 'test') $$,
  '42501', null, 'stranger cannot insert items');
select throws_ok($$ delete from public.items $$, null, null, 'stranger cannot delete items');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$ delete from public.items $$, null, null, 'anon cannot delete items');

reset role;
select table_privs_are('public', 'hub_state', 'anon', array[]::text[], 'anon has no grants on hub_state');
select table_privs_are('public', 'memo_files', 'anon', array[]::text[], 'anon has no grants on memo_files');
select table_privs_are('public', 'audit_log', 'anon', array[]::text[], 'anon has no grants on audit_log');
select table_privs_are('public', 'items', 'anon', array[]::text[], 'anon has no grants on items');
select table_privs_are('public', 'comments', 'anon', array[]::text[], 'anon has no grants on comments');
select table_privs_are('public', 'hub_state', 'authenticated', array[]::text[], 'authenticated has no grants on hub_state');
select table_privs_are('public', 'memo_files', 'authenticated', array[]::text[], 'authenticated has no grants on memo_files');
select table_privs_are('public', 'audit_log', 'authenticated', array[]::text[], 'authenticated has no grants on audit_log');

select * from finish();
rollback;
