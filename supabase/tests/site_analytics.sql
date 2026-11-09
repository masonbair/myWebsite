begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(35);

create temporary table today_value as select (now() at time zone 'America/New_York')::date as d;
grant select on today_value to service_role, authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'stranger@example.com');
insert into public.hub_owner (user_id) values ('00000000-0000-0000-0000-00000000000a');

select ok(not has_function_privilege('anon', 'public.analytics_record(text, text, text, text, text, text, text, text)', 'execute'), 'anon cannot record');
select ok(not has_function_privilege('authenticated', 'public.analytics_record(text, text, text, text, text, text, text, text)', 'execute'), 'authenticated cannot record');
select ok(has_function_privilege('service_role', 'public.analytics_record(text, text, text, text, text, text, text, text)', 'execute'), 'service_role can record');
select ok(not has_table_privilege('service_role', 'public.analytics_daily', 'insert'), 'service_role cannot insert rollups directly');
select ok(not has_table_privilege('service_role', 'public.analytics_daily', 'update'), 'service_role cannot update rollups directly');
select ok(not has_table_privilege('anon', 'public.analytics_daily', 'select'), 'anon cannot read rollups');
select ok(not has_table_privilege('anon', 'public.analytics_visitors', 'select'), 'anon cannot read visitors');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ select public.analytics_record('/coffee', 'human', '', 'chatgpt.com', 'ChatGPT', 'us', '', repeat('a', 64)) $$, 'a human visit records');
select lives_ok($$ select public.analytics_record('/coffee', 'human', '', 'chatgpt.com', 'ChatGPT', 'us', '', repeat('a', 64)) $$, 'the same visitor again records');
select lives_ok($$ select public.analytics_record('/', 'ai', 'GPTBot', '', '', 'US', 'should be dropped', null) $$, 'a bot visit records');
select lives_ok($$ select public.analytics_record('/wp-admin/../x?q=1', 'bot', 'unknown', 'Evil.COM/path', '', 'USA', repeat('u', 500), null) $$, 'junk input records safely');
reset role;

select is((select hits from public.analytics_daily where path = '/coffee' and ref_host = 'chatgpt.com'), 2, 'repeat visits bump one counter');
select is((select country from public.analytics_daily where path = '/coffee'), 'US', 'country is upper-cased');
select is((select count(*)::int from public.analytics_visitors), 1, 'one visitor per page per day');
select is((select ua_sample from public.analytics_daily where agent = 'GPTBot'), '', 'known bots keep no user-agent');
select is((select path from public.analytics_daily where agent = 'unknown'), 'other', 'odd paths fold to other');
select is((select ref_host from public.analytics_daily where agent = 'unknown'), 'invalid', 'a referrer that is not a host is not stored');
select is((select country from public.analytics_daily where agent = 'unknown'), '', 'a bad country becomes empty');
select is((select length(ua_sample) from public.analytics_daily where agent = 'unknown'), 120, 'unknown bot user-agent is cut to 120 chars');

select throws_ok($$ delete from public.analytics_daily $$, 'P0001', null, 'rollups are never deleted');
select throws_ok($$ delete from public.analytics_visitors $$, 'P0001', null, 'visitor hashes cannot be deleted directly');
select ok(not has_function_privilege('anon', 'public.analytics_roll_visitors()', 'execute'), 'anon cannot roll visitors');
select ok(not has_function_privilege('authenticated', 'public.analytics_roll_visitors()', 'execute'), 'authenticated cannot roll visitors');

insert into public.analytics_visitors (day, path, visitor_hash) values
  ((select d - 1 from today_value), '/', repeat('c', 64)),
  ((select d - 1 from today_value), '/coffee', repeat('c', 64)),
  ((select d - 1 from today_value), '/coffee', repeat('d', 64));
set local role service_role;
select public.analytics_record('/', 'ai', 'GPTBot', '', '', '', '', null);
reset role;
select is((select count(*)::int from public.analytics_visitors where day < (select d from today_value)), 0, 'the first visit of a day removes past hashes');
select is((select visitors from public.analytics_uniques where path = '*'), 2, 'past hashes become a site-wide unique count');
select is((select visitors from public.analytics_uniques where path = '/coffee'), 2, 'and a per-page unique count');
select is((select count(*)::int from public.analytics_visitors where day = (select d from today_value)), 1, 'today''s hashes stay');
select throws_ok($$ delete from public.analytics_uniques $$, 'P0001', null, 'unique counts are never deleted');
set local analytics.rolling = 'on';
select throws_ok($$ delete from public.analytics_visitors $$, 'P0001', null, 'today''s hashes cannot be deleted even with the rolling flag');
reset analytics.rolling;

insert into public.analytics_daily (day, path, kind, agent, ref_host, hits)
select (select d from today_value), 'other', 'bot', 'filler', 'f' || g || '.example', 1 from generate_series(1, 5000) g;
insert into public.analytics_visitors (day, path, visitor_hash)
select (select d from today_value), 'other', encode(sha256(g::text::bytea), 'hex') from generate_series(1, 20000) g;

set local role service_role;
select public.analytics_record('/', 'human', '', 'brand-new.example', '', 'DE', '', repeat('b', 64));
reset role;
select is((select hits from public.analytics_daily where agent = 'overflow'), 1, 'past 5,000 daily rows new combinations fold into overflow');
select is((select count(*)::int from public.analytics_visitors where visitor_hash = repeat('b', 64)), 0, 'past 20,000 visitor hashes no more are stored');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select is((select count(*)::int from public.analytics_daily), 0, 'a stranger sees no rollups');
select is((public.analytics_report(7) -> 'week' ->> 'aiReads')::int, 0, 'a stranger''s report is empty');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select ok((public.analytics_report(7) -> 'week' ->> 'aiReads')::int >= 1, 'the owner''s report counts AI reads');
reset role;
select ok(not has_function_privilege('anon', 'public.analytics_report(integer)', 'execute'), 'anon cannot run the report');

select * from finish();
rollback;
