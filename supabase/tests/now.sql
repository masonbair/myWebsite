begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'now-owner@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'now-stranger@example.com');
insert into public.hub_owner (user_id) values ('00000000-0000-0000-0000-0000000000a1');

select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name in ('now_place', 'now_bake')
     and column_name ~ '(lat|lon|lng|coord|geo)'),
  0,
  'no coordinate columns on the now tables'
);
select ok((select relrowsecurity from pg_class where oid = 'public.now_place'::regclass), 'now_place has RLS on');
select ok((select relrowsecurity from pg_class where oid = 'public.now_bake'::regclass), 'now_bake has RLS on');
select ok(not has_table_privilege('anon', 'public.now_place', 'select'), 'anon cannot read now_place');
select ok(not has_table_privilege('anon', 'public.now_bake', 'select'), 'anon cannot read now_bake');
select ok(not has_table_privilege('authenticated', 'public.now_place', 'select'), 'authenticated cannot read now_place');
select ok(not has_table_privilege('authenticated', 'public.now_bake', 'select'), 'authenticated cannot read now_bake');
select ok(not has_table_privilege('authenticated', 'public.now_place', 'update'), 'authenticated cannot edit a place');
select ok(not has_table_privilege('authenticated', 'public.now_bake', 'update'), 'authenticated cannot edit a bake');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$ insert into public.now_bake (name) values ('anon bread') $$,
  '42501', null, 'anon cannot log a bake'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$ insert into public.now_bake (name) values ('stranger bread') $$,
  '42501', null, 'a signed-in stranger cannot log a bake'
);
select throws_ok(
  $$ insert into public.now_place (city, country) values ('Nowhere', 'Neverland') $$,
  '42501', null, 'a signed-in stranger cannot write a place'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ insert into public.now_bake (name, photo) values ('pgtap sourdough', '/misc/bread.webp') $$,
  'the owner can log a bake'
);
select lives_ok(
  $$ insert into public.now_place (city, region, country, private) values ('Kent', 'Ohio', 'United States', true) $$,
  'the owner can write a place'
);
select throws_ok(
  $$ insert into public.now_bake (name, photo) values ('bad photo', 'https://example.com/x.webp') $$,
  '23514', null, 'a bake photo must be a /misc path'
);
select throws_ok(
  $$ insert into public.now_bake (name, photo) values ('sneaky photo', '/misc/..evil.webp') $$,
  '23514', null, 'a bake photo cannot climb out of /misc'
);
select throws_ok(
  $$ insert into public.now_bake (name) values ('   ') $$,
  '23514', null, 'a bake needs a name'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((select count(*)::int from public.now_bake where name = 'pgtap sourdough'), 1, 'the service role reads bakes');
select throws_ok($$ delete from public.now_bake $$, null, null, 'bakes are never deleted, even by the service role');
select throws_ok($$ delete from public.now_place $$, null, null, 'places are never deleted, even by the service role');

reset role;
select throws_ok($$ truncate public.now_bake $$, null, null, 'now_bake cannot be truncated');
select throws_ok($$ truncate public.now_place $$, null, null, 'now_place cannot be truncated');

select * from finish();
rollback;
