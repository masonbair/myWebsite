begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(51);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'now-owner@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'now-stranger@example.com');
insert into public.hub_owner (user_id) values ('00000000-0000-0000-0000-0000000000a1');

select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name in ('now_place', 'now_bake', 'now_place_privacy')
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
select ok((select relrowsecurity from pg_class where oid = 'public.now_place_privacy'::regclass), 'now_place_privacy has RLS on');
select ok(not has_table_privilege('anon', 'public.now_place_privacy', 'select'), 'anon cannot read place privacy');
select ok(not has_table_privilege('authenticated', 'public.now_place_privacy', 'select'), 'authenticated cannot read place privacy');
select ok(not has_table_privilege('authenticated', 'public.now_place_privacy', 'update'), 'authenticated cannot edit place privacy');
select ok(
  not has_sequence_privilege('anon', 'public.now_place_id_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'public.now_bake_id_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'public.now_place_privacy_id_seq', 'usage'),
  'anon and authenticated have no rights on the id sequences'
);
select ok(
  not has_function_privilege('anon', 'public.now_current_place()', 'execute')
  and not has_function_privilege('authenticated', 'public.now_current_place()', 'execute'),
  'only the server can read the current place'
);

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

select throws_ok(
  $$ insert into public.now_place_privacy (city, country, private) values ('Kent', 'United States', false) $$,
  '42501', null, 'a signed-in stranger cannot change place privacy'
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
select lives_ok(
  $$ insert into public.now_place_privacy (city, region, country, private) values ('Kent', 'Ohio', 'United States', true) $$,
  'the owner can mark a place private'
);
select lives_ok(
  $$ insert into public.now_place (city, country, time_zone) values ('Lisbon', 'Portugal', 'Europe/Lisbon') $$,
  'the owner can send a real IANA time zone with a place'
);
select throws_ok(
  $$ insert into public.now_place (city, country, time_zone) values ('Lisbon', 'Portugal', 'Mars/Olympus') $$,
  '22023', null, 'an unknown time zone is refused'
);
select throws_ok(
  $$ insert into public.now_place (city, country, time_zone) values ('Lisbon', 'Portugal', '') $$,
  '22023', null, 'an empty time zone is refused'
);
select lives_ok(
  $$ insert into public.now_place (city, country) values ('Lisbon', 'Portugal') $$,
  'a place without a time zone is fine'
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
select throws_ok($$ delete from public.now_place_privacy $$, null, null, 'privacy rows are never deleted');

insert into public.now_place (city, region, country, private) values ('Home Town', 'Ohio', 'United States', false);
select is((select private from public.now_current_place()), false, 'a new place starts public');
insert into public.now_place_privacy (city, region, country, private) values ('home town', 'OHIO', 'united states', true);
insert into public.now_place (city, region, country, private) values ('Home Town', 'Ohio', 'United States', false);
select is(
  (select private from public.now_current_place()), true,
  'a fresh public ping from a place marked private stays private (matched ignoring case)'
);
insert into public.now_place_privacy (city, region, country, private) values ('Home Town', 'Ohio', 'United States', false);
select is((select private from public.now_current_place()), false, 'marking the place public again shows it');
insert into public.now_place (city, region, country, private) values ('Elsewhere', 'Ohio', 'United States', true);
select is((select (private, sent_private) from public.now_current_place()), (true, true), 'a ping sent as private is private');

select throws_ok($$ update public.now_place set private = false $$, null, null, 'places are never edited, even by the service role');
select throws_ok($$ update public.now_bake set name = 'renamed' $$, null, null, 'bakes are never edited, even by the service role');
select throws_ok(
  $$ update public.now_place_privacy set private = false $$, null, null,
  'a privacy rule cannot be quietly flipped, even by the service role'
);

insert into public.now_place_privacy (city, region, country, private) values ('  Columbus ', 'Ohio', 'United States', true);
select results_eq(
  $$ select city, region, country from public.now_place_privacy order by id desc limit 1 $$,
  $$ values ('columbus'::text, 'ohio'::text, 'us'::text) $$,
  'privacy rows are stored normalized, with the country as a code'
);
insert into public.now_place (city, region, country, private) values ('columbus ', 'OH', 'US', false);
select is((select private from public.now_current_place()), true, 'the rule hides "columbus , OH, US"');
insert into public.now_place (city, region, country, private) values ('Columbus', '', 'USA', false);
select is((select private from public.now_current_place()), true, 'the rule hides "Columbus, , USA"');
insert into public.now_place (city, region, country, private) values ('COLUMBUS', 'Ohio', 'United States of America', false);
select is((select private from public.now_current_place()), true, 'the rule hides "COLUMBUS, Ohio, United States of America"');
insert into public.now_place (city, region, country, private) values ('Columbus', 'Georgia', 'United States', false);
select is((select private from public.now_current_place()), true, 'region is ignored, so any private rule for the city wins');
insert into public.now_place (city, region, country, private) values ('Columbus', '', 'Canada', false);
select is((select private from public.now_current_place()), false, 'a city of the same name in another country is not hidden');
select is(public.now_country_code(' The  Netherlands '), 'nl', 'country names with odd spacing still map to a code');
select is(public.now_country_code('Atlantis'), 'atlantis', 'an unknown country falls back to its normalized name');

reset role;
select throws_ok($$ truncate public.now_bake $$, null, null, 'now_bake cannot be truncated');
select throws_ok($$ truncate public.now_place $$, null, null, 'now_place cannot be truncated');
select throws_ok($$ truncate public.now_place_privacy $$, null, null, 'now_place_privacy cannot be truncated');

select * from finish();
rollback;
