begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(36);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'stranger@example.com');
insert into public.hub_owner (user_id) values ('00000000-0000-0000-0000-00000000000a');

insert into public.items (id, title, source, labels) values
  ('10000000-0000-0000-0000-000000000001', 'survivor', 'test', '{}'),
  ('10000000-0000-0000-0000-000000000002', 'to complete', 'test', '{}'),
  ('10000000-0000-0000-0000-000000000003', 'duplicate', 'test', '{}'),
  ('10000000-0000-0000-0000-000000000004', 'approved for claude', 'test', '{todo,claude,claude-done}');
insert into public.comments (id, item_id, body, author) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'hello', 'mason');

select throws_ok($$ delete from public.items $$, 'P0001', null, 'postgres cannot delete items');
select throws_ok($$ delete from public.comments $$, 'P0001', null, 'postgres cannot delete comments');

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
select is((select count(*)::int from public.items), 4, 'owner sees every item');
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

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$ update public.items set state = 'open' where id = '10000000-0000-0000-0000-000000000002' $$,
  'P0001', null, 'service_role cannot reopen a done item');

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
