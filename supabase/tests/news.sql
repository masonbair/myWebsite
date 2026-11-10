begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(129);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'news-owner@example.com'),
  ('00000000-0000-0000-0000-0000000000b9', 'news-stranger@example.com');
insert into public.hub_owner (user_id) values ('00000000-0000-0000-0000-0000000000a9');

select is(
  (select array_agg(id order by id) from public.news_sources),
  array['mindstream', 'morning-brew', 'rundown-ai', 'shared', 'superhuman', 'tech-brew', 'the-hustle'],
  'the six newsletters and shared are seeded');
select is(
  (select public from public.news_sources where id = 'shared'), false, 'shared is never public');
select is(
  (select jsonb_object_agg(id, sender_addresses) from public.news_sources
   where id in ('mindstream', 'superhuman', 'the-hustle', 'tech-brew')),
  '{"mindstream": ["hello@mindstream.news"], "superhuman": ["superhuman@mail.joinsuperhuman.ai"],
    "the-hustle": ["news@thehustle.co"], "tech-brew": ["techbrew@morningbrew.com"]}'::jsonb,
  'four sources have exactly their sender addresses');
select is(
  (select jsonb_object_agg(id, sender_addresses) from public.news_sources
   where id in ('morning-brew', 'rundown-ai')),
  '{"morning-brew": ["crew@morningbrew.com"], "rundown-ai": ["news@daily.therundown.ai"]}'::jsonb,
  'morning-brew and rundown-ai have exactly their sender addresses');
select is(
  (select count(*)::int from public.news_sources
   where id in ('morning-brew', 'rundown-ai') and sender_domains = '{}'),
  2, 'morning-brew and rundown-ai have no sender domains');
select is(
  (select count(*)::int from public.news_sources where sender_domains <> '{}'),
  0, 'no source matches by domain');
select is(
  (select count(*)::int from public.news_sources where archive_pattern is not null),
  0, 'archive_pattern is null for every source');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'news\_%' and not c.relrowsecurity),
  0, 'every news table has RLS on');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'news\_%' and grantee in ('anon', 'PUBLIC')),
  0, 'anon has no grants on any news table');
select is(
  (select array_agg(distinct privilege_type::text) from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'news\_%' and grantee = 'authenticated'),
  array['SELECT'], 'authenticated may only select on news tables');
select table_privs_are('public', 'news_trends_daily', 'authenticated', array[]::text[], 'authenticated has no grants on news_trends_daily');
select table_privs_are('public', 'news_trends_coverage', 'authenticated', array[]::text[], 'authenticated has no grants on news_trends_coverage');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'news\_%'
     and (has_sequence_privilege('anon', c.oid, 'usage') or has_sequence_privilege('authenticated', c.oid, 'usage')
          or has_sequence_privilege('authenticated', c.oid, 'select'))),
  0, 'anon and authenticated have no rights on news sequences');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'news\_%' and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon cannot execute any news function');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'news\_%' and has_function_privilege('authenticated', p.oid, 'execute')),
  array['news_release_issue', 'news_retry'], 'news_release_issue and news_retry are the only news functions authenticated can execute');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'news\_%'
     and not coalesce(p.proconfig @> array['search_path=""'], false)),
  0, 'every news function pins an empty search_path');
select ok(
  has_function_privilege('service_role', 'public.news_claim(text, integer, interval)', 'execute')
  and has_function_privilege('service_role', 'public.news_refresh_trends(date, date)', 'execute')
  and has_function_privilege('service_role', 'public.news_public_trends(date, date)', 'execute')
  and has_function_privilege('service_role', 'public.news_public_coverage(text, text, date)', 'execute')
  and has_function_privilege('service_role', 'public.news_story_counts(text, text[], date, date, text)', 'execute')
  and has_function_privilege('service_role', 'public.news_story_movers(integer, integer)', 'execute'),
  'service_role can run the job and public functions');
select ok(
  not has_function_privilege('service_role', 'public.news_retry(uuid)', 'execute'),
  'service_role cannot call news_retry');
select ok(
  not has_function_privilege('service_role', 'public.news_release_issue(uuid, text)', 'execute'),
  'service_role cannot call news_release_issue');
select columns_are('public', 'news_trends_daily',
  array['day', 'kind', 'key', 'stories', 'mentions', 'tone_avg', 'sources'],
  'news_trends_daily has only count columns');
select columns_are('public', 'news_trends_coverage',
  array['day', 'kind', 'key', 'source_id', 'public_url'],
  'news_trends_coverage has no text from emails');

insert into public.news_extraction_runs (id, model, prompt_version, kind) values
  (900001, 'claude-sonnet-5-5', 'v1', 'daily'),
  (900002, 'claude-sonnet-5-5', 'v0', 'daily');
insert into public.news_topics (slug, name) values
  ('test-chips', 'Chips'), ('test-ai', 'AI models'), ('test-hidden', 'Hidden'), ('test-off', 'Switched off');
insert into public.news_sources (id, name, public) values ('test-private', 'Private letter', false);
insert into public.news_companies (id, name, norm_name, ticker, exchange, ticker_verified) values
  (900001, 'Nvidia', 'test-nvidia', 'NVDA', 'NASDAQ', true),
  (900002, 'OpenAI', 'test-openai', 'OAI', null, false);
insert into public.news_clusters (id, first_date) values (900001, '2001-01-02'), (900002, '2001-01-02');

insert into public.news_issues
  (id, source_id, message_id, subject, from_address, raw_path, clean_text, status, attempts, next_attempt_at, claimed_at, current_run_id, public_url, published_on)
values
  ('90000000-0000-0000-0000-000000000001', 'morning-brew', '<a@test>', 'A', 'a@test', 'news/raw/a.eml', 'text a', 'done', 0, null, null, 900001,
   'https://www.morningbrew.com/daily/issues/2001-01-02', '2001-01-02'),
  ('90000000-0000-0000-0000-000000000002', 'tech-brew', '<b@test>', 'B', 'b@test', 'news/raw/b.eml', 'text b', 'done', 0, null, null, 900001, null, '2001-01-02'),
  ('90000000-0000-0000-0000-000000000003', 'the-hustle', '<c@test>', 'C', 'c@test', 'news/raw/c.eml', '', 'pending', 0, null, null, null, null, null),
  ('90000000-0000-0000-0000-000000000004', 'the-hustle', '<d@test>', 'D', 'd@test', 'news/raw/d.eml', 'd', 'pending', 0, null, null, null, null, null),
  ('90000000-0000-0000-0000-000000000005', 'the-hustle', '<e@test>', 'E', 'e@test', 'news/raw/e.eml', 'e', 'pending', 0, null, null, null, null, null),
  ('90000000-0000-0000-0000-000000000006', 'mindstream', '<f@test>', 'F', 'f@test', 'news/raw/f.eml', 'f', 'failed', 1, now() - interval '1 minute', null, null, null, null),
  ('90000000-0000-0000-0000-000000000007', 'mindstream', '<g@test>', 'G', 'g@test', 'news/raw/g.eml', 'g', 'failed', 3, now() - interval '1 minute', null, null, null, null),
  ('90000000-0000-0000-0000-000000000008', 'mindstream', '<h@test>', 'H', 'h@test', 'news/raw/h.eml', 'h', 'failed', 1, now() + interval '1 hour', null, null, null, null),
  ('90000000-0000-0000-0000-000000000009', 'superhuman', '<i@test>', 'I', 'i@test', 'news/raw/i.eml', 'i', 'processing', 0, null, now() - interval '1 hour', null, null, null),
  ('90000000-0000-0000-0000-00000000000a', 'superhuman', '<j@test>', 'J', 'j@test', 'news/raw/j.eml', 'j', 'processing', 0, null, now(), null, null, null),
  ('90000000-0000-0000-0000-00000000000b', 'superhuman', '<k@test>', 'K', 'k@test', 'news/raw/k.eml', 'k', 'processing', 2, null, now() - interval '1 hour', null, null, null),
  ('90000000-0000-0000-0000-00000000000c', null, '<l@test>', 'L', 'l@test', 'news/raw/l.eml', 'l', 'quarantined', 0, null, null, null, null, null),
  ('90000000-0000-0000-0000-00000000000d', 'mindstream', '<m@test>', 'M', 'm@test', 'news/raw/m.eml', 'm', 'quarantined', 0, null, null, null, null, null),
  ('90000000-0000-0000-0000-00000000000e', null, '<n@test>', 'N', 'n@test', 'news/raw/n.eml', 'n', 'quarantined', 0, null, null, null, null, null);

insert into public.items (id, title, source) values ('91000000-0000-0000-0000-000000000001', 'shared fixture', 'test');
insert into public.news_shared (id, item_id, url, title, status, current_run_id) values
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'https://example.com/shared', 'shared', 'done', 900001);

insert into public.news_stories (id, run_id, issue_id, shared_id, source_id, story_date, headline, kind, sentiment, topics, company_ids, cluster_id) values
  (900001, 900001, '90000000-0000-0000-0000-000000000001', null, 'morning-brew', '2001-01-02', 'h1', 'news', 1, '{test-chips}', '{900001,900002}', 900001),
  (900002, 900001, '90000000-0000-0000-0000-000000000002', null, 'tech-brew', '2001-01-02', 'h2', 'news', -1, '{test-chips}', '{900001}', 900001),
  (900003, 900001, '90000000-0000-0000-0000-000000000001', null, 'morning-brew', '2001-01-02', 'h3', 'sponsor', 2, '{test-chips}', '{900001}', null),
  (900004, 900002, '90000000-0000-0000-0000-000000000001', null, 'morning-brew', '2001-01-02', 'h4', 'news', 2, '{test-chips}', '{900001}', null),
  (900005, 900001, null, '92000000-0000-0000-0000-000000000001', 'shared', '2001-01-02', 'h5', 'news', 2, '{test-chips}', '{900001}', null),
  (900006, 900001, '90000000-0000-0000-0000-000000000001', null, 'morning-brew', '2001-01-02', 'h6', 'news', 2, '{test-ai}', '{}', null),
  (900007, 900001, '90000000-0000-0000-0000-000000000002', null, 'tech-brew', '2001-01-02', 'h7', 'news', 0, '{test-ai}', '{}', null),
  (900008, 900001, '90000000-0000-0000-0000-000000000001', null, 'morning-brew', '2001-01-02', 'h8', 'news', 0, '{test-off}', '{}', null);

insert into public.news_issues (id, source_id, message_id, status, current_run_id) values
  ('93000000-0000-0000-0000-000000000001', 'test-private', '<p@test>', 'done', 900001);
insert into public.news_stories (id, run_id, issue_id, source_id, story_date, headline, kind, sentiment, topics) values
  (900009, 900001, '93000000-0000-0000-0000-000000000001', 'morning-brew', '2001-01-02', 'h9', 'news', 0, '{test-hidden}');

insert into public.items (id, title, source) values ('91000000-0000-0000-0000-000000000005', 'failed shared fixture', 'test');
insert into public.news_shared (id, item_id, url, title, status, attempts) values
  ('92000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000005', 'https://example.com/failed', 'failed', 'failed', 3);

select throws_ok(
  $$ insert into public.news_stories (run_id, issue_id, shared_id, source_id, story_date, headline, kind, sentiment)
     values (900001, '90000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', 'morning-brew', '2001-01-02', 'x', 'news', 0) $$,
  '23514', null, 'a story belongs to an issue or a shared row, not both');
select throws_ok(
  $$ insert into public.news_stories (run_id, issue_id, source_id, story_date, headline, kind, sentiment)
     values (900001, '90000000-0000-0000-0000-000000000001', 'morning-brew', '2001-01-02', 'x', 'news', 3) $$,
  '23514', null, 'sentiment stays between -2 and 2');
select throws_ok(
  $$ insert into public.news_topics (slug, name) values ('Bad Slug!', 'bad') $$,
  '23514', null, 'topic slugs are lowercase words and dashes');

select throws_ok($$ delete from public.news_issues $$, 'P0001', 'rows in news_issues are never deleted', 'postgres cannot delete news_issues');
select throws_ok($$ truncate public.news_stories $$, 'P0001', 'rows in news_stories are never deleted', 'postgres cannot truncate news_stories');
select throws_ok($$ delete from public.news_shared $$, 'P0001', null, 'postgres cannot delete news_shared');
select throws_ok($$ delete from public.news_stories $$, 'P0001', null, 'postgres cannot delete news_stories');
select throws_ok($$ delete from public.news_extraction_runs $$, 'P0001', null, 'postgres cannot delete news_extraction_runs');
select throws_ok($$ delete from public.news_clusters $$, 'P0001', null, 'postgres cannot delete news_clusters');
select throws_ok($$ delete from public.news_sources $$, 'P0001', null, 'postgres cannot delete news_sources');
select throws_ok($$ delete from public.news_topics $$, 'P0001', null, 'postgres cannot delete news_topics');
select throws_ok($$ delete from public.news_companies $$, 'P0001', null, 'postgres cannot delete news_companies');
select throws_ok($$ truncate public.news_issues cascade $$, 'P0001', null, 'postgres cannot truncate news_issues');
select throws_ok($$ truncate public.news_shared cascade $$, 'P0001', null, 'postgres cannot truncate news_shared');
select throws_ok($$ truncate public.news_extraction_runs cascade $$, 'P0001', null, 'postgres cannot truncate news_extraction_runs');
select throws_ok($$ truncate public.news_clusters cascade $$, 'P0001', null, 'postgres cannot truncate news_clusters');
select throws_ok($$ truncate public.news_sources cascade $$, 'P0001', null, 'postgres cannot truncate news_sources');
select throws_ok($$ truncate public.news_topics cascade $$, 'P0001', null, 'postgres cannot truncate news_topics');
select throws_ok($$ truncate public.news_companies cascade $$, 'P0001', null, 'postgres cannot truncate news_companies');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select throws_ok(
  $$ update public.news_issues set clean_text = 'rewritten' where id = '90000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'clean_text never changes once written');
select lives_ok(
  $$ update public.news_issues set clean_text = 'restored' where id = '90000000-0000-0000-0000-000000000003' $$,
  'an empty clean_text can be refilled');
select throws_ok(
  $$ update public.news_issues set clean_text = '' where id = '90000000-0000-0000-0000-000000000003' $$,
  'P0001', null, 'a refilled clean_text cannot be emptied again');
select throws_ok(
  $$ update public.news_issues set subject = 'other' where id = '90000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'subject never changes');
select throws_ok(
  $$ update public.news_issues set message_id = '<other@test>' where id = '90000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'message_id never changes');
select throws_ok(
  $$ update public.news_issues set from_address = 'x@test' where id = '90000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'from_address never changes');
select throws_ok(
  $$ update public.news_issues set raw_path = 'elsewhere' where id = '90000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'raw_path never changes');
select throws_ok(
  $$ update public.news_issues set source_id = 'tech-brew' where id = '90000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'source_id never changes');
select throws_ok(
  $$ update public.news_issues set source_id = null where id = '90000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'source_id is never cleared');
select lives_ok(
  $$ update public.news_issues set source_id = 'tech-brew' where id = '90000000-0000-0000-0000-00000000000e' $$,
  'a null source_id may be set once');
select lives_ok(
  $$ update public.news_issues set status = 'done', last_error = null where id = '90000000-0000-0000-0000-000000000001' $$,
  'service_role can change status');
select throws_ok(
  $$ update public.news_issues set public_url = 'https://evil.example/?u=mason' where id = '90000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'public_url never carries a query string');

select lives_ok(
  $$ update public.news_stories set cluster_id = 900002 where id = 900006 $$,
  'a story joins a cluster once');
select throws_ok(
  $$ update public.news_stories set cluster_id = 900001 where id = 900006 $$,
  'P0001', null, 'a story never moves to another cluster');
select throws_ok(
  $$ update public.news_stories set headline = 'rewritten' where id = 900007 $$,
  'P0001', null, 'a story headline never changes');

select lives_ok(
  $$ update public.news_shared set fetched_text = 'page text', thin = false where id = '92000000-0000-0000-0000-000000000001' $$,
  'fetched_text can be filled once');
select throws_ok(
  $$ update public.news_shared set fetched_text = 'other text' where id = '92000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'fetched_text never changes once filled');
select throws_ok(
  $$ update public.news_shared set url = 'https://example.com/other' where id = '92000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'a shared url never changes');

reset role;
create temp table claim_first (id uuid);
create temp table claim_second (id uuid);
create temp table claim_third (id uuid);
grant all on claim_first, claim_second, claim_third to service_role;
set local role service_role;

insert into claim_first select public.news_claim('issue', 3);
insert into claim_second select public.news_claim('issue', 3);
insert into claim_third select public.news_claim('issue', 3);
select is((select count(*)::int from claim_first), 3, 'first claim takes its limit');
select is((select count(*)::int from claim_second), 2, 'second claim takes the rest');
select is((select count(*)::int from claim_third), 0, 'nothing is left to claim');
select is((select count(*)::int from claim_first join claim_second using (id)), 0, 'two claims never overlap');
select set_eq(
  $$ select id from claim_first union all select id from claim_second $$,
  $$ values ('90000000-0000-0000-0000-000000000003'::uuid), ('90000000-0000-0000-0000-000000000004'),
            ('90000000-0000-0000-0000-000000000005'), ('90000000-0000-0000-0000-000000000006'),
            ('90000000-0000-0000-0000-000000000009') $$,
  'claims take pending, due failed and stale processing rows only');
select is(
  (select status from public.news_issues where id = '90000000-0000-0000-0000-000000000007'),
  'failed', 'a failed row with attempts = 3 is never claimed');
select is(
  (select count(*)::int from public.news_issues
   where id in (select id from claim_first union all select id from claim_second)
     and status = 'processing' and claimed_at = now()),
  5, 'claimed rows are processing with a fresh claimed_at');
select is(
  (select attempts from public.news_issues where id = '90000000-0000-0000-0000-000000000009'),
  1, 'reclaiming a stale row counts the stopped attempt');
select is(
  (select status || ' ' || attempts || ' ' || last_error from public.news_issues where id = '90000000-0000-0000-0000-00000000000b'),
  'failed 3 the job stopped while working on this 3 times', 'a row that stopped the job 3 times ends failed instead of being reclaimed');
select throws_ok($$ select public.news_claim('bogus', 1) $$, 'P0001', null, 'news_claim refuses an unknown kind');

select lives_ok($$ select public.news_refresh_trends('2001-01-01', '2001-01-03') $$, 'trends refresh runs');
select lives_ok($$ select public.news_refresh_trends('2001-01-01', '2001-01-03') $$, 'trends refresh runs again over the same range');
select results_eq(
  $$ select stories, mentions, tone_avg, sources from public.news_trends_daily
     where day = '2001-01-02' and kind = 'topic' and key = 'test-chips' $$,
  $$ values (1, 2, 0.00::numeric(4,2), array['morning-brew', 'tech-brew']) $$,
  'one cluster from two sources counts 1 story and 2 mentions; sponsor, shared and old-run rows add nothing');
select results_eq(
  $$ select stories, mentions from public.news_trends_daily
     where day = '2001-01-02' and kind = 'topic' and key = 'test-ai' $$,
  $$ values (2, 2) $$,
  'unclustered stories count once each');
select results_eq(
  $$ select key, stories, mentions from public.news_trends_daily
     where day = '2001-01-02' and kind = 'company' order by key $$,
  $$ values ('900001', 1, 2), ('900002', 1, 1) $$,
  'companies are counted by cluster too');
select results_eq(
  $$ select source_id, public_url from public.news_trends_coverage
     where day = '2001-01-02' and kind = 'topic' and key = 'test-chips' order by source_id $$,
  $$ values ('morning-brew', 'https://www.morningbrew.com/daily/issues/2001-01-02'), ('tech-brew', 'https://www.techbrew.com') $$,
  'coverage links the issue or falls back to the homepage');
select is(
  (select count(*)::int from public.news_trends_daily where key = 'test-hidden')
  + (select count(*)::int from public.news_trends_coverage where key = 'test-hidden'),
  0, 'a story from an issue of a non-public newsletter adds nothing, whatever its own source_id says');

reset role;
update public.news_topics set active = false where slug = 'test-off';
insert into public.news_trends_coverage (day, kind, key, source_id, public_url)
  values ('2001-01-02', 'topic', 'test-chips', 'test-private', 'https://private.example/issue');
set local role service_role;
select is(
  (select count(*)::int from public.news_trends_daily where kind = 'topic' and key = 'test-off'),
  1, 'a topic switched off after the rebuild still has its trend row');
select is(
  (select count(*)::int from public.news_public_trends('2001-01-01', '2001-01-03') where kind = 'topic' and key = 'test-off'),
  0, 'public trends leave out a topic that is switched off');
select is(
  (select count(*)::int from public.news_public_coverage('topic', 'test-chips', '2001-01-01') where source_name = 'Private letter'),
  0, 'public coverage leaves out a newsletter that is not public');

select results_eq(
  $$ select key, label, ticker from public.news_public_trends('2001-01-01', '2001-01-03')
     where kind = 'company' order by key $$,
  $$ values ('900001', 'Nvidia', 'NVDA'), ('900002', 'OpenAI', null) $$,
  'public trends show a verified ticker and hide an unverified one');
select results_eq(
  $$ select label, stories, mentions from public.news_public_trends('2001-01-01', '2001-01-03')
     where kind = 'topic' and key = 'test-chips' $$,
  $$ values ('Chips', 1, 2) $$,
  'public trends label topics by name');
select results_eq(
  $$ select source_name, public_url from public.news_public_coverage('topic', 'test-chips', '2001-01-01') order by source_name $$,
  $$ values ('Morning Brew', 'https://www.morningbrew.com/daily/issues/2001-01-02'), ('Tech Brew', 'https://www.techbrew.com') $$,
  'public coverage names each newsletter');

select results_eq(
  $$ select bucket, stories, mentions, tone_avg from public.news_story_counts('topic', array['test-chips'], '2001-01-01', '2001-01-03', 'day') $$,
  $$ values ('2001-01-02'::date, 2, 3, 0.67::numeric) $$,
  'story counts use the current run, include shared reads, skip sponsors and count a cluster once');
select results_eq(
  $$ select stories, mentions from public.news_story_counts('company', array['900001'], '2001-01-01', '2001-01-03', 'month') $$,
  $$ values (2, 3) $$,
  'story counts match companies and bucket by month');
select is(
  (select count(*)::int from public.news_story_counts('topic', array['test-chips'], '2001-01-03', '2001-01-04', 'day')),
  0, 'story counts honour the date range');
select is(
  (select count(*)::int from public.news_story_counts('topic', array['test-chips'], '2001-01-01', '2001-01-03', 'year')),
  0, 'story counts refuse an unknown bucket');
select lives_ok(
  $$ insert into public.news_stories (run_id, issue_id, source_id, story_date, headline, kind, sentiment, topics)
     select 900001, '90000000-0000-0000-0000-000000000001', 'morning-brew', (now() at time zone 'utc')::date, 'm' || n, 'news', 0, '{test-mover}'
     from generate_series(1, 3) n $$,
  'three recent stories are added');
select results_eq(
  $$ select kind, key, recent, previous from public.news_story_movers(7, 50) where key = 'test-mover' $$,
  $$ values ('topic', 'test-mover', 3, 0) $$,
  'a topic with three recent stories and none before shows as more coverage');

select throws_ok(
  $$ select public.news_retry('90000000-0000-0000-0000-000000000007') $$,
  '42501', null, 'service_role cannot call news_retry');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$ select count(*) from public.news_issues $$, '42501', null, 'anon cannot read news_issues');
select throws_ok($$ select count(*) from public.news_trends_daily $$, '42501', null, 'anon cannot read news_trends_daily');
select throws_ok($$ select * from public.news_public_trends('2001-01-01', '2001-01-03') $$, '42501', null, 'anon cannot run news_public_trends');
select throws_ok($$ select public.news_retry('90000000-0000-0000-0000-000000000007') $$, '42501', null, 'anon cannot call news_retry');
select throws_ok(
  $$ select public.news_release_issue('90000000-0000-0000-0000-00000000000c', 'morning-brew') $$,
  '42501', null, 'anon cannot call news_release_issue');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b9","role":"authenticated"}';
select is(
  (select count(*)::int from public.news_sources) + (select count(*)::int from public.news_issues)
  + (select count(*)::int from public.news_shared) + (select count(*)::int from public.news_extraction_runs)
  + (select count(*)::int from public.news_topics) + (select count(*)::int from public.news_companies)
  + (select count(*)::int from public.news_sec_tickers) + (select count(*)::int from public.news_clusters)
  + (select count(*)::int from public.news_stories),
  0, 'a stranger sees no rows in any news table');
select is(
  public.news_retry('90000000-0000-0000-0000-000000000007'), false, 'a stranger cannot retry');
select is(
  public.news_release_issue('90000000-0000-0000-0000-00000000000c', 'morning-brew'), false, 'a stranger cannot release held-back mail');
select throws_ok($$ select * from public.news_public_trends('2001-01-01', '2001-01-03') $$, '42501', null, 'authenticated cannot run news_public_trends');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated"}';
select is(
  (select count(*)::int from public.news_issues where id::text like '90000000-%'), 14, 'the owner reads news_issues');
select throws_ok($$ select count(*) from public.news_trends_daily $$, '42501', null, 'the owner gets permission denied on news_trends_daily');
select throws_ok(
  $$ update public.news_issues set status = 'pending' where id = '90000000-0000-0000-0000-000000000007' $$,
  '42501', null, 'the owner cannot update news_issues directly');
select is(public.news_retry('90000000-0000-0000-0000-000000000007'), true, 'the owner retries a failed issue');
select results_eq(
  $$ select status, attempts from public.news_issues where id = '90000000-0000-0000-0000-000000000007' $$,
  $$ values ('pending', 0) $$,
  'retry moves the issue to pending with attempts reset');
select is(public.news_retry('90000000-0000-0000-0000-000000000001'), false, 'retry ignores a row that is not failed');
select is(public.news_retry('92000000-0000-0000-0000-000000000002'), true, 'the owner retries a failed shared row');
select results_eq(
  $$ select status, attempts from public.news_shared where id = '92000000-0000-0000-0000-000000000002' $$,
  $$ values ('pending', 0) $$,
  'retry moves the shared row to pending with attempts reset');

select is(public.news_release_issue('90000000-0000-0000-0000-00000000000c', 'nope'), false, 'release refuses an unknown source');
select is(public.news_release_issue('90000000-0000-0000-0000-00000000000c', 'shared'), false, 'release refuses the shared source');
select is(public.news_release_issue('90000000-0000-0000-0000-00000000000d', 'morning-brew'), false, 'release never moves mail to another newsletter');
select is(public.news_release_issue('90000000-0000-0000-0000-000000000001', 'morning-brew'), false, 'release ignores mail that is not held back');
select is(public.news_release_issue('90000000-0000-0000-0000-00000000000c', 'morning-brew'), true, 'the owner releases held-back mail with no source');
select results_eq(
  $$ select source_id, status, attempts from public.news_issues where id = '90000000-0000-0000-0000-00000000000c' $$,
  $$ values ('morning-brew'::text, 'pending'::text, 0) $$,
  'release sets the source and queues the issue');
select is(public.news_release_issue('90000000-0000-0000-0000-00000000000d', 'mindstream'), true, 'the owner releases held-back mail that already matched a newsletter');

select lives_ok(
  $$ insert into public.items (id, title, source, description)
     values ('91000000-0000-0000-0000-000000000002', 'a shared page', 'share', 'Read this https://example.com/a?b=1') $$,
  'the owner shares a link');
select results_eq(
  $$ select url, status from public.news_shared where item_id = '91000000-0000-0000-0000-000000000002' $$,
  $$ values ('https://example.com/a?b=1', 'pending') $$,
  'a share with a link adds one pending news_shared row');
select lives_ok(
  $$ insert into public.items (id, title, source, description)
     values ('91000000-0000-0000-0000-000000000003', 'a capture', 'capture', 'see https://example.com/c') $$,
  'the owner captures a note with a link');
select is(
  (select count(*)::int from public.news_shared where item_id = '91000000-0000-0000-0000-000000000003'),
  0, 'a capture adds no news_shared row');
select lives_ok(
  $$ insert into public.items (id, title, source, description)
     values ('91000000-0000-0000-0000-000000000004', 'linkless share', 'share', 'no link here') $$,
  'the owner shares text with no link');
select is(
  (select count(*)::int from public.news_shared where item_id = '91000000-0000-0000-0000-000000000004'),
  0, 'a share without a link adds no news_shared row');
insert into public.items (id, title, source, description) values
  ('91000000-0000-0000-0000-000000000006', 'wiki', 'share', 'https://en.wikipedia.org/wiki/Foo_(bar)'),
  ('91000000-0000-0000-0000-000000000007', 'aside', 'share', '(see https://x.example/a).');
select is(
  (select url from public.news_shared where item_id = '91000000-0000-0000-0000-000000000006'),
  'https://en.wikipedia.org/wiki/Foo_(bar)', 'a share keeps a closing paren that belongs to the link');
select is(
  (select url from public.news_shared where item_id = '91000000-0000-0000-0000-000000000007'),
  'https://x.example/a', 'a share drops a closing paren and period that belong to the sentence');

reset role;
alter table public.news_shared add constraint force_share_failure check (url <> 'https://example.com/broken');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated"}';
select lives_ok(
  $$ insert into public.items (id, title, source, description)
     values ('91000000-0000-0000-0000-000000000008', 'broken share', 'share', 'https://example.com/broken') $$,
  'the share saves even when its news_shared row cannot be written');
select is(
  (select count(*)::int from public.items where id = '91000000-0000-0000-0000-000000000008'),
  1, 'the share whose news row failed is kept');
reset role;
select is(
  (select count(*)::int from public.news_shared where item_id = '91000000-0000-0000-0000-000000000008'),
  0, 'a failed news_shared insert leaves no row');
alter table public.news_shared drop constraint force_share_failure;

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select set_eq(
  $$ select public.news_claim('shared', 10) $$,
  $$ select id from public.news_shared where item_id in ('91000000-0000-0000-0000-000000000002',
       '91000000-0000-0000-0000-000000000005', '91000000-0000-0000-0000-000000000006', '91000000-0000-0000-0000-000000000007') $$,
  'news_claim takes exactly the pending shared rows');

reset role;
select results_eq(
  $$ select schedule, command from cron.job where jobname = 'hub-news' $$,
  $$ values ('*/30 * * * *'::text, ' select public.hub_post_event(''news'') '::text) $$,
  'the news job runs every 30 minutes');
select has_column('public', 'ai_usage', 'news_issue_id', 'ai_usage links a charge to its issue');
select fk_ok('public', 'ai_usage', 'news_issue_id', 'public', 'news_issues', 'id', 'ai_usage.news_issue_id points at news_issues');
select is(
  (select count(*)::int from public.news_topics where active and slug in (
    'ai-models', 'chips', 'climate-change', 'interest-rates', 'jobs', 'retail', 'crypto', 'ev-batteries', 'streaming',
    'space', 'cybersecurity', 'healthcare', 'energy', 'housing', 'trade-tariffs', 'earnings', 'ipos', 'mergers',
    'regulation', 'social-media', 'consumer-tech', 'autos', 'travel', 'food-and-beverage', 'media', 'labor',
    'inflation', 'banking', 'venture-capital', 'robotics')),
  30, 'the provisional topic list is seeded');
select table_privs_are('public', 'ai_usage', 'authenticated', array['SELECT'], 'authenticated still only reads ai_usage');

select * from finish();
rollback;
