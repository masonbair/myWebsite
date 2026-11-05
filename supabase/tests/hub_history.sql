begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'stranger@example.com');
insert into public.hub_owner (user_id) values ('00000000-0000-0000-0000-00000000000a');

alter table public.items disable trigger user;
insert into public.items (id, title, description, source, state) values
  ('10000000-0000-0000-0000-000000000001', 'call the bank', 'about the card', 'test', 'open'),
  ('10000000-0000-0000-0000-000000000002', 'finished thing', 'what I did', 'test', 'done');
alter table public.items enable trigger user;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

update public.items set description = '' where id = '10000000-0000-0000-0000-000000000001';
select results_eq(
  $$ select title, description, changed_by from public.items_history where item_id = '10000000-0000-0000-0000-000000000001' $$,
  $$ values ('call the bank'::text, 'about the card'::text, 'service_role'::text) $$,
  'clearing a description as service_role keeps the old text');

update public.items set title = 'call the bank today' where id = '10000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.items_history where item_id = '10000000-0000-0000-0000-000000000001'), 2,
  'a title rewrite adds another row');

update public.items set labels = '{todo}', list = 'todo' where id = '10000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.items_history where item_id = '10000000-0000-0000-0000-000000000001'), 2,
  'a label or list change adds no row');

update public.items set title = 'rewritten after done' where id = '10000000-0000-0000-0000-000000000002';
select results_eq(
  $$ select title, description from public.items_history where item_id = '10000000-0000-0000-0000-000000000002' $$,
  $$ values ('finished thing'::text, 'what I did'::text) $$,
  'a done item rewritten by service_role still keeps its old text');

select throws_ok($$ update public.items_history set title = 'x' $$, '42501', null, 'service_role cannot edit history');
select throws_ok($$ delete from public.items_history $$, '42501', null, 'service_role cannot delete history');
select throws_ok($$ truncate public.items_history $$, '42501', null, 'service_role cannot truncate history');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(public.is_owner(), true, 'signed in as the owner');
update public.items set title = 'owner retitles it' where id = '10000000-0000-0000-0000-000000000001';
select is(
  (select title from public.items where id = '10000000-0000-0000-0000-000000000001'), 'owner retitles it',
  'the owner edit saves');
select is(
  (select count(*)::int from public.items_history where item_id = '10000000-0000-0000-0000-000000000001'), 2,
  'an edit by the signed-in owner adds no row');
select is((select count(*)::int from public.items_history where item_id::text like '10000000-%'), 3, 'the owner reads every history row');
select throws_ok(
  $$ insert into public.items_history (item_id, title, description, changed_by)
     values ('10000000-0000-0000-0000-000000000001', 'fake', '', 'me') $$,
  '42501', null, 'the owner cannot write history by hand');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select is((select count(*)::int from public.items_history), 0, 'a stranger reads no history');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$ select * from public.items_history $$, '42501', null, 'anon cannot read history');

reset role;
select throws_ok($$ update public.items_history set title = 'x' $$, 'P0001', null, 'postgres cannot edit history');
select throws_ok($$ delete from public.items_history $$, 'P0001', null, 'postgres cannot delete history');
select throws_ok($$ truncate public.items_history $$, 'P0001', null, 'postgres cannot truncate history');
select table_privs_are('public', 'items_history', 'authenticated', array['SELECT'], 'authenticated may only select history');

select * from finish();
rollback;
