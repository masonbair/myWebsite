begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

select ok(
  not has_function_privilege('anon', 'public.hub_accept_memo(text, timestamp, text, text, text, text[], text)', 'execute'),
  'anon cannot accept a memo'
);
select ok(
  not has_function_privilege('authenticated', 'public.hub_accept_memo(text, timestamp, text, text, text, text[], text)', 'execute'),
  'authenticated cannot accept a memo'
);
select ok(
  has_function_privilege('service_role', 'public.hub_accept_memo(text, timestamp, text, text, text, text[], text)', 'execute'),
  'service_role can accept a memo'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.hub_accept_memo(text, timestamp, text, text, text, text[], text)'::regprocedure),
  false,
  'hub_accept_memo runs as its caller, so RLS grants and triggers apply as usual'
);

create temporary table first_call (item_id uuid, duplicate boolean) on commit drop;
create temporary table second_call (item_id uuid, duplicate boolean) on commit drop;
grant all on first_call, second_call to service_role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

insert into first_call
  select * from public.hub_accept_memo(
    'pgtap-Rec01.hda', '2026-10-22T18:35:04', 'phone', 'HiDock memo pgtap-Rec01',
    'Source: HiDock pgtap-Rec01.hda', array['transcript (part 1 of 2):\na', 'transcript (part 2 of 2):\nb'], 'worker:memo-relay'
  );
insert into second_call
  select * from public.hub_accept_memo(
    'pgtap-Rec01.hda', '2026-10-22T18:35:04', 'mac', 'HiDock memo pgtap-Rec01',
    'Source: HiDock pgtap-Rec01.hda', array['transcript (part 1 of 1):\nab'], 'worker:memo-relay'
  );

select is((select duplicate from first_call), false, 'the first upload is new');
select is((select duplicate from second_call), true, 'the same file again is a duplicate');
select is((select item_id from second_call), (select item_id from first_call), 'the duplicate returns the same item id');
select is(
  (select count(*)::int from public.items where title = 'HiDock memo pgtap-Rec01'),
  1,
  'two uploads of one file make one item'
);
select results_eq(
  $$ select labels, list, state, source from public.items where id = (select item_id from first_call) $$,
  $$ values (array['hidock-memo'], 'inbox', 'open', 'memo:phone') $$,
  'the memo is an open hidock-memo inbox item from the first device'
);
select results_eq(
  $$ select body, author from public.comments where item_id = (select item_id from first_call) order by created_at $$,
  $$ values ('transcript (part 1 of 2):\na', 'worker'), ('transcript (part 2 of 2):\nb', 'worker') $$,
  'the transcript parts are worker comments, in order'
);
select is(
  (select item_id from public.memo_files where file = 'pgtap-Rec01.hda'),
  (select item_id from first_call),
  'memo_files points at the item'
);
select is(
  (select count(*)::int from public.audit_log where item_id = (select item_id from first_call) and actor = 'worker:memo-relay'),
  1,
  'one audit row for the new memo'
);

insert into public.memo_files (file) values ('pgtap-seeded.hda');
select results_eq(
  $$ select item_id, duplicate from public.hub_accept_memo('pgtap-seeded.hda', null, 'mac', 't', 'd', array['x'], 'worker:memo-relay') $$,
  $$ values (null::uuid, true) $$,
  'a seeded file is a duplicate with no item'
);

select throws_ok(
  $$ select * from public.hub_accept_memo('', null, 'phone', 't', 'd', array['x'], 'worker:memo-relay') $$,
  'P0001', 'a memo needs a file name', 'an empty file name is rejected'
);
select throws_ok(
  $$ select * from public.hub_accept_memo('pgtap-empty.hda', null, 'phone', 't', 'd', array[]::text[], 'worker:memo-relay') $$,
  'P0001', 'a memo needs a transcript', 'an empty transcript is rejected'
);
select is(
  (select count(*)::int from public.memo_files where file = 'pgtap-empty.hda'),
  0,
  'a rejected memo leaves no memo_files row'
);

select * from finish();
rollback;
